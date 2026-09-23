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

export function summarize(project: Project, claims: Claim[], results: CheckResult[]): string {
  if (claims.length === 0) {
    return `Obelus found no checkable factual claims in this announcement about ${projectLabel(project)}.`;
  }

  const byId = new Map(claims.map((c) => [c.id, c]));
  const count = (v: CheckResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  const verified = count("VERIFIED");
  const contradicted = count("CONTRADICTED");
  const unverified = count("UNVERIFIED");

  const parts: string[] = [
    `Obelus checked ${claims.length} claim${claims.length === 1 ? "" : "s"} about ${projectLabel(project)}: ` +
      `${verified} verified, ${contradicted} contradicted, ${unverified} unverified.`,
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

  if (unverified) {
    parts.push(
      `Unverified means no primary source could confirm it — not that it is false.`,
    );
  }

  return parts.join(" ");
}
