"use client";

/**
 * The check form. Posts to /api/check and reads its Server-Sent Events as they arrive,
 * writing each step into the margin — the agent's decisions, live (§5, §13). EventSource
 * can't POST, so the stream is read from fetch directly.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { Example } from "@/src/lib/examples";

type Step = { t: string; step: string };

function* parseEvents(buffer: string): Generator<{ event: string; data: string }> {
  for (const block of buffer.split("\n\n")) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) yield { event, data: data.join("\n") };
  }
}

type Props = {
  /** Shown as "Try" chips under the box. */
  examples?: Example[];
  /** "hero" on the landing page (compact), "page" on /check (roomier, with guidance). */
  variant?: "hero" | "page";
  autoFocus?: boolean;
};

export function Checker({ examples = [], variant = "page", autoFocus = false }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);

  async function run(text: string) {
    const value = text.trim();
    if (!value || running) return;
    setRunning(true);
    setError(null);
    setSteps([]);
    queueMicrotask(() => notesRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: value }),
      });

      // Refusals before streaming starts (rate limit, empty input) come back as JSON.
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `The check could not start (HTTP ${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        // Only parse complete events; keep the tail for the next chunk.
        const cut = buffer.lastIndexOf("\n\n");
        if (cut === -1) continue;
        const complete = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);

        for (const { event, data } of parseEvents(complete)) {
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (event === "trace") setSteps((s) => [...s, payload as Step]);
          if (event === "error") throw new Error(String(payload.message ?? "The check failed."));
          if (event === "done") {
            router.push(`/r/${payload.reportId}`);
            return;
          }
        }
      }
      throw new Error("The connection closed before the check finished. Try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  function runExample(ex: Example) {
    if (ex.reportId) {
      router.push(`/r/${ex.reportId}`);
      return;
    }
    setInput(ex.input);
    void run(ex.input);
  }

  return (
    <div className="checker" data-variant={variant}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <label htmlFor="checker-input" className="checker-label">
          Paste a link or an announcement, or ask a listing question
        </label>
        <div className="checker-box">
          <textarea
            id="checker-input"
            name="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run(input);
              }
            }}
            placeholder={"https://x.com/…/status/…\nor: Is $PEPE listed on MEXC?"}
            rows={variant === "hero" ? 3 : 7}
            disabled={running}
            maxLength={20_000}
            spellCheck={false}
            autoFocus={autoFocus}
          />
          <div className="checker-bar">
            <span className="checker-hint">X posts, web pages, pasted text, or a question</span>
            <button className="button" type="submit" disabled={running || !input.trim()}>
              {running ? "Checking…" : "Check it"}
            </button>
          </div>
        </div>
      </form>

      {examples.length > 0 && !running && (
        <div className="try">
          <span className="try-label">Try</span>
          {examples.map((ex) => (
            <button key={ex.id} type="button" className="chip" onClick={() => runExample(ex)} title={ex.note}>
              {ex.chip ?? ex.label}
            </button>
          ))}
        </div>
      )}

      <div ref={notesRef} aria-live="polite">
        {steps.length > 0 && (
          <ol className="progress">
            {steps.map((s, i) => (
              <li key={`${s.t}-${s.step}`} data-current={running && i === steps.length - 1 ? "" : undefined}>
                {s.step}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
