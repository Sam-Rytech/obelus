"use client";

/** The status panel (§12): which primary sources are answering right now. */
import { useEffect, useState } from "react";

import { Sign } from "./Sign";

type State = "up" | "down" | "not configured" | "configured";
type Source = { id: string; label: string; role: string; state: State; ms?: number; detail?: string };
type Health = { status: string; checkedAt: string; sources: Source[] };

const VERDICT = {
  up: "VERIFIED",
  down: "CONTRADICTED",
  "not configured": "UNVERIFIED",
  configured: "UNVERIFIED",
} as const;
const WORD = {
  up: "answering",
  down: "not answering",
  "not configured": "not set up",
  configured: "set up, but not called here, to save credits",
} as const;

export function SourceStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="meta">The status check itself couldn&rsquo;t run.</p>;
  if (!health) return <p className="meta">Checking each source…</p>;

  return (
    <>
      <ul className="status-list">
        {health.sources.map((s) => (
          <li key={s.id} className="margined">
            <div className="sign" data-verdict={VERDICT[s.state]}>
              <Sign verdict={VERDICT[s.state]} />
            </div>
            <div>
              <strong>{s.label}</strong> is {WORD[s.state]}
              {s.ms !== undefined && s.state === "up" ? ` (${s.ms} ms)` : ""}
              {s.state === "down" && s.detail ? `: ${s.detail}` : ""}
              <span className="meta"> — {s.role}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="meta">
        Checked {new Date(health.checkedAt).toUTCString()}. If a source isn&rsquo;t answering, claims that rely on
        it come back unverified — never guessed.
      </p>
    </>
  );
}
