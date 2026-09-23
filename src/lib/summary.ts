/**
 * Plain-English report summary — architecture §5 step 5.
 *
 * Deviation from §5: written by code from the results, not by the LLM. §8 requires the
 * summary to contain no verdict that isn't in `results`, and no prompt can guarantee
 * that of free text. Built from the results themselves, it is correct by construction —
 * and a report costs one model call (extraction) instead of two.
 */
import type { CheckResult, Claim, Project } from "./schema";

function projectLabel(p: Project): string {
  if (p.name && p.ticker) return `${p.name} (${p.ticker})`;
  return p.name ?? p.ticker ?? "this project";
}

function shortQuote(q: string, max = 90): string {
  const flat = q.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The part of a reason after the code — "OWNER_IS 0x.. — ownership ..." -> "ownership ...". */
function plainReason(reason: string): string {
  const i = reason.indexOf(" — ");
  return i === -1 ? reason : reason.slice(i + 3);
}

/**
 * Verdict counts for people. "Not checkable" (NOT_CHECKABLE_V1: user counts, roadmap
 * promises…) is still an UNVERIFIED verdict — the stored results and receipts don't
 * change — but it is shown separately: on the first 11 real announcements, 47 of 60
 * "unverified" claims were of this kind, and one lumped count made every report look
 * far weaker than its checkable claims actually were.
 */
export type Tally = { verified: number; contradicted: number; unverified: number; notCheckable: number };

export function isNotCheckable(r: Pick<CheckResult, "verdict" | "reason">): boolean {
  return r.verdict === "UNVERIFIED" && r.reason.startsWith("NOT_CHECKABLE_V1");
}

export function tally(results: Pick<CheckResult, "verdict" | "reason">[]): Tally {
  const t: Tally = { verified: 0, contradicted: 0, unverified: 0, notCheckable: 0 };
  for (const r of results) {
    if (r.verdict === "VERIFIED") t.verified++;
    else if (r.verdict === "CONTRADICTED") t.contradicted++;
    else if (isNotCheckable(r)) t.notCheckable++;
    else t.unverified++;
  }
  return t;
}

export function summarize(project: Project, claims: Claim[], results: CheckResult[]): string {
  if (claims.length === 0) {
    return `Obelus found no checkable factual claims in this announcement about ${projectLabel(project)}.`;
  }

  const byId = new Map(claims.map((c) => [c.id, c]));
  const t = tally(results);

  const parts: string[] = [
    `Obelus checked ${claims.length} claim${claims.length === 1 ? "" : "s"} about ${projectLabel(project)}: ` +
      `${t.verified} verified, ${t.contradicted} contradicted, ${t.unverified} unverified` +
      (t.notCheckable ? `, and ${t.notCheckable} of a kind Obelus can't check yet.` : "."),
  ];

  // Lead with what's false: that is what a reader most needs before acting.
  const contra = results.filter((r) => r.verdict === "CONTRADICTED");
  for (const r of contra.slice(0, 3)) {
    const claim = byId.get(r.claimId);
    if (claim) parts.push(`Contradicted by the primary source: "${shortQuote(claim.quote)}" — ${plainReason(r.reason)}.`);
  }

  const qualified = results.filter((r) => r.verdict === "VERIFIED" && r.qualifier);
  if (qualified.length) {
    parts.push(
      `${qualified.length} verified claim${qualified.length === 1 ? " carries" : "s carry"} a caveat (see each card).`,
    );
  }

  if (t.unverified) {
    parts.push(
      `Unverified means no primary source could confirm it — not that it is false.`,
    );
  }

  return parts.join(" ");
}
