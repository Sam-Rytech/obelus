/**
 * Checker contract — architecture §10.
 *
 * Every checker has the same shape and the same obligations:
 *   - It reads a PRIMARY source (the one that can actually confirm the claim).
 *   - It returns a verdict decided by code, never by a model.
 *   - It attaches the evidence that decided it: URL, fetched excerpt, timestamp.
 *   - On any error it returns UNVERIFIED, never a guess (§18 fail-closed).
 */
import type { PublicClient } from "viem";

import { BudgetExhaustedError, type Budget } from "../lib/budget";
import type { Searcher } from "../lib/search";
import type { CheckResult, Claim, Evidence, Project, Verdict } from "../lib/schema";
import type { Trace } from "../lib/trace";

export type Ctx = {
  budget: Budget;
  trace: Trace;
  /** Per-call timeout in ms. §18 caps every external call at 8 s. */
  timeoutMs: number;
  /** Injected in tests; created lazily from env otherwise. */
  search?: Searcher;
  rpc?: PublicClient;
};

export type Checker = (claim: Claim, project: Project, ctx: Ctx) => Promise<CheckResult>;

export const CALL_TIMEOUT_MS = 8_000;

export function evidence(source: string, url: string, excerpt: string): Evidence {
  return {
    source,
    url,
    fetchedAt: new Date().toISOString(),
    // Evidence is shown verbatim to the user; keep it readable, not a JSON dump.
    excerpt: excerpt.replace(/\s+/g, " ").trim().slice(0, 600),
  };
}

export function result(
  claim: Claim,
  verdict: Verdict,
  reason: string,
  ev: Evidence[],
  qualifier?: string,
): CheckResult {
  return { claimId: claim.id, verdict, reason, evidence: ev, ...(qualifier ? { qualifier } : {}) };
}

/**
 * Wrap any checker so an unexpected failure becomes UNVERIFIED rather than a crashed
 * report. §18: fail closed — a source we could not read is not evidence of anything.
 */
export function failClosed(name: string, claim: Claim, err: unknown): CheckResult {
  // Running out of budget is not a source failure, and the report should say which.
  if (err instanceof BudgetExhaustedError) {
    return result(
      claim,
      "UNVERIFIED",
      `BUDGET_EXHAUSTED — the ${err.limit}-call budget for this report ran out before ${name} could be checked`,
      [],
      "Not checked: budget exhausted",
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return result(claim, "UNVERIFIED", `SOURCE_ERROR:${name} — ${message.slice(0, 160)}`, []);
}

/**
 * Fetch text with a timeout. A non-2xx is returned (with its status), not thrown,
 * because for several sources a 404 is a meaningful answer — CertiK's "no such
 * project" is exactly that. Transport failures still throw and fail closed.
 */
export async function getText(
  url: string,
  ctx: Ctx,
  init?: RequestInit,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      // Some upstreams (CertiK) serve differently to non-browser agents.
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  return { status: res.status, body: await res.text() };
}

/** Fetch JSON with a timeout and no ambient credentials. */
export async function getJson<T>(url: string, ctx: Ctx, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": "ObelusBot/0.1 (crypto announcement fact-checker)",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
