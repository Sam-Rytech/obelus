"use client";

/** Live status of every primary source (§12), grouped by what each one is used for. */
import { useCallback, useEffect, useState } from "react";

type State = "up" | "down" | "not configured" | "configured";
type Source = { id: string; label: string; role: string; state: State; ms?: number; detail?: string };
type Health = { status: string; checkedAt: string; sources: Source[] };

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Exchange listings", ids: ["weex", "bingx", "mexc", "bybit", "binance", "okx"] },
  { title: "Audits and partnerships", ids: ["certik", "tavily"] },
  { title: "On-chain and market data", ids: ["base", "dexscreener", "defillama"] },
  { title: "Reading the announcement", ids: ["fxtwitter", "groq", "gemini", "anthropic"] },
  { title: "Reports and receipts", ids: ["redis", "eas"] },
];

const WORD: Record<State, string> = {
  up: "Answering",
  down: "Not answering",
  "not configured": "Not set up",
  configured: "Set up",
};

export function SourceStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const grouped = health
    ? [
        ...GROUPS.map((g) => ({ title: g.title, sources: health.sources.filter((s) => g.ids.includes(s.id)) })),
        {
          title: "Other",
          sources: health.sources.filter((s) => !GROUPS.some((g) => g.ids.includes(s.id))),
        },
      ].filter((g) => g.sources.length)
    : [];

  return (
    <div className="status">
      <div className="status-bar">
        <p className="status-summary">
          {failed
            ? "The status check itself couldn’t run."
            : !health
              ? "Asking each source…"
              : `${health.sources.filter((s) => s.state === "up").length} of ${health.sources.length} sources answering. Checked ${new Date(health.checkedAt).toUTCString()}.`}
        </p>
        <button type="button" className="button button-small button-quiet" onClick={load} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>

      {grouped.map((g) => (
        <section key={g.title} className="status-group" aria-label={g.title}>
          <h2>{g.title}</h2>
          <ul>
            {g.sources.map((s) => (
              <li key={s.id} data-state={s.state}>
                <span className="status-dot" aria-hidden="true" />
                <span className="status-name">{s.label}</span>
                <span className="status-role">{s.role}</span>
                <span className="status-state">
                  {WORD[s.state]}
                  {s.state === "up" && s.ms !== undefined ? `, ${s.ms} ms` : ""}
                  {s.state === "down" && s.detail ? `: ${s.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
