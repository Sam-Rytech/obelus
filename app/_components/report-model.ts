/**
 * What the report UI needs from a stored report, in plain serializable shapes — built on
 * the server, handed to client components. Display only: verdicts are read, never made.
 */
import { annotate, type Annotated } from "@/src/lib/annotate";
import type { CheckResult, Claim, ClaimType, Report } from "@/src/lib/schema";
import { isNotCheckable } from "@/src/lib/summary";

/** A verdict as people read it: "not checkable yet" is split out of unverified (summary.ts). */
export type Category = "VERIFIED" | "CONTRADICTED" | "UNVERIFIED" | "NOT_CHECKABLE";

export type Entry = {
  id: string;
  quote: string;
  kind: string;
  category: Category;
  qualifier?: string;
  reason: string;
  evidence: CheckResult["evidence"];
  /** The exchange a listing claim is about (question mode shows one row per exchange). */
  exchange?: string;
};

const CLAIM_KIND: Record<ClaimType, string> = {
  EXCHANGE_LISTING: "Exchange listing",
  AUDIT: "Security audit",
  OWNERSHIP_RENOUNCED: "Ownership renounced",
  LIQUIDITY_LOCK: "Liquidity lock",
  PARTNERSHIP: "Partnership",
  TVL: "Total value locked",
  OTHER: "Other claim",
};

/** Reasons are "CODE — explanation"; people read the explanation. */
export function plainReason(reason: string): string {
  const i = reason.indexOf(" — ");
  const text = i === -1 ? reason : reason.slice(i + 3);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindOf(claim: Claim): string {
  const p = claim.params;
  const target =
    typeof p.exchange === "string"
      ? ` on ${p.exchange}`
      : typeof p.auditor === "string"
        ? ` by ${p.auditor}`
        : typeof p.partner === "string"
          ? ` with ${p.partner}`
          : "";
  return CLAIM_KIND[claim.type] + target;
}

export function categoryOf(r: Pick<CheckResult, "verdict" | "reason">): Category {
  return isNotCheckable(r) ? "NOT_CHECKABLE" : r.verdict;
}

export function buildEntries(report: Report): Entry[] {
  const byClaim = new Map(report.results.map((r) => [r.claimId, r]));
  return report.claims.flatMap((c) => {
    const r = byClaim.get(c.id);
    if (!r) return [];
    return [
      {
        id: c.id,
        quote: c.quote.replace(/\s+/g, " ").trim(),
        kind: kindOf(c),
        category: categoryOf(r),
        qualifier: r.qualifier,
        reason: plainReason(r.reason),
        evidence: r.evidence,
        exchange: typeof c.params.exchange === "string" ? c.params.exchange : undefined,
      },
    ];
  });
}

/** Worst first: what a reader most needs before acting. */
export const PRIORITY: Record<Category, number> = { CONTRADICTED: 0, VERIFIED: 1, UNVERIFIED: 2, NOT_CHECKABLE: 3 };

/** The claim a report opens on, and the one a gallery card leads with. */
export function headline(entries: Entry[]): Entry | undefined {
  return [...entries].sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category])[0];
}

export function annotateReport(report: Report): Annotated {
  return annotate(report.input.fetchedText, report.claims);
}

/** §15: the synthetic example must always be labelled as such. */
export function isTestAnnouncement(r: Report): boolean {
  return /TEST ANNOUNCEMENT\s*[—-]\s*written by the Obelus team/i.test(r.input.fetchedText);
}

export function projectTitle(r: Report): string {
  const { name, ticker } = r.project;
  if (r.mode === "question") return `Is ${ticker ?? "it"} listed?`;
  if (name && ticker) return `${name} (${ticker})`;
  return name ?? ticker ?? "Unnamed project";
}

/** Where the text came from, in words: "chainwire.org", "an X post", "pasted text". */
export function sourceLabel(r: Report): { label: string; href?: string } {
  if (r.mode === "question") return { label: "a question" };
  if (r.input.kind === "text") return { label: "pasted text" };
  if (r.input.kind === "x") return { label: "an X post", href: r.input.value };
  try {
    return { label: new URL(r.input.value).hostname.replace(/^www\./, ""), href: r.input.value };
  } catch {
    return { label: "a web page", href: r.input.value };
  }
}

export function formatUtc(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
