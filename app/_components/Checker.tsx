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

export function Checker({ examples }: { examples: Example[] }) {
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
    <>
      <form
        className="check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <label htmlFor="input">An X post link, a web page URL, or the announcement text</label>
        <textarea
          id="input"
          name="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste an announcement, e.g. “$NOVA is now listed on BingX and audited by CertiK…”"
          disabled={running}
          maxLength={20_000}
          spellCheck={false}
        />
        <div className="actions">
          <button className="button" type="submit" disabled={running || !input.trim()}>
            {running ? "Checking…" : "Check announcement"}
          </button>
          {examples.map((ex) => (
            <span key={ex.id} className="meta">
              <button type="button" className="linkish" onClick={() => runExample(ex)} disabled={running}>
                {ex.label}
              </button>{" "}
              <span>({ex.note})</span>
            </span>
          ))}
        </div>
      </form>

      <div ref={notesRef} aria-live="polite">
        {steps.length > 0 && (
          <div className="notes">
            <ol>
              {steps.map((s) => (
                <li key={`${s.t}-${s.step}`}>
                  <span>{s.step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
