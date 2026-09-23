/**
 * AUDIT checker — architecture §10.2.
 *
 * CertiK path, verified Sep 22–23 across audited and unaudited projects:
 *   - Fetch skynet.certik.com/projects/<slug> DIRECTLY (Tavily only as a fallback).
 *   - HTTP 404                              -> no record          -> UNVERIFIED
 *   - "Not Audited By CertiK" badge         -> page says no       -> CONTRADICTED
 *   - "N Audits available", N >= 1          -> page says yes      -> VERIFIED
 *   - anything else                         -> can't read it      -> UNVERIFIED
 *
 * "Code Audit History" is a static heading on every page, audited or not, so it is
 * NEVER used as the positive signal. The positive signal is the audit count.
 *
 * Other auditors: domain-restricted search. VERIFIED only when a sentence on an
 * auditor-controlled domain names the project AND uses audit language (and doesn't
 * negate it); a bare mention is UNVERIFIED MENTION_ONLY. A PDF on the project's own
 * site never counts (§10.2 step 4), which the domain restriction enforces.
 */
import { cached, TTL } from "../lib/cache";
import { REASON, type Claim, type Project } from "../lib/schema";
import { createSearcher, isOnDomain, type Searcher } from "../lib/search";
import { findAuditor } from "../registry/index";
import { compact, mentionsName, sentences } from "./text";
import { evidence, failClosed, getText, result, type Ctx } from "./types";

const SKYNET = "https://skynet.certik.com/projects/";
const BADGE = "Not Audited By CertiK";

/** Qualifier on every VERIFIED audit (§10.2 step 5). */
export const AUDIT_SCOPE_QUALIFIER = "Report exists — v1 does not confirm which contract it covered";

export function certikSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type CertikReading =
  | { kind: "missing" }
  | { kind: "not-audited"; excerpt: string }
  | { kind: "audited"; count: number; lastDelivered?: string; excerpt: string }
  | { kind: "unreadable"; excerpt: string };

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Pure: turn a Skynet response into a reading. Exported for exhaustive testing. */
export function readCertikPage(status: number, html: string): CertikReading {
  if (status === 404) return { kind: "missing" };
  if (status !== 200) throw new Error(`CertiK returned HTTP ${status}`);

  const at = html.indexOf("Code Audit History");
  const section =
    at === -1
      ? ""
      : stripHtml(html.slice(at, at + 12_000))
          .replace(/<[^>]*$/, "") // the slice can cut a tag in half; drop the fragment
          .split(/Missing Info\?|Token Scan/)[0]! // the rest of the page isn't about audits
          .trim()
          .slice(0, 600);

  if (html.includes(BADGE)) {
    return { kind: "not-audited", excerpt: section || BADGE };
  }

  const count = section.match(/(\d+)\s+Audits?\s+available/i);
  if (count?.[1] && Number(count[1]) >= 1) {
    const last = section.match(/Last Audit was delivered on ([A-Za-z]{3,9} \d{1,2}, \d{4})/i);
    return {
      kind: "audited",
      count: Number(count[1]),
      lastDelivered: last?.[1],
      excerpt: section,
    };
  }

  return { kind: "unreadable", excerpt: section.slice(0, 200) };
}

/**
 * Pick the slug whose name matches the project, from fallback search results.
 * Verified Sep 23: a search for "PancakeSwap" also returned four-meme,
 * solidus-ai-tech, imp-money and bitswap — taking the first hit would audit-check
 * the wrong project entirely.
 */
export function pickCertikSlug(urls: string[], projectName: string): string | null {
  const want = compact(projectName);
  for (const url of urls) {
    const slug = url.match(/skynet\.certik\.com\/projects\/([a-z0-9-]+)/i)?.[1];
    if (slug && compact(slug) === want) return slug.toLowerCase();
  }
  return null;
}

async function readSlug(slug: string, ctx: Ctx): Promise<CertikReading> {
  // Cache the parsed reading, never the ~850 KB page (Upstash values cap at 1 MB).
  // v2 key: v1 readings were cached before the half-cut-tag fix and still leaked HTML.
  return cached(`certik:v2:${slug}`, TTL.CERTIK, async () => {
    ctx.budget.spend("certik:page");
    const { status, body } = await getText(`${SKYNET}${slug}`, ctx);
    return readCertikPage(status, body);
  });
}

async function checkCertik(claim: Claim, projectName: string, ctx: Ctx) {
  let slug = certikSlug(projectName);
  let reading = await readSlug(slug, ctx);
  let viaSearch = false;

  if (reading.kind === "missing") {
    // The name we derived may not be CertiK's slug; ask search, but match by name.
    let searcher: Searcher | undefined = ctx.search;
    try {
      searcher ??= createSearcher();
    } catch {
      searcher = undefined; // no Tavily key: the direct miss stands
    }
    if (searcher) {
      ctx.budget.spend("tavily:certik-fallback");
      const results = await searcher.search(projectName, ["skynet.certik.com"]);
      const found = pickCertikSlug(
        results.map((r) => r.url),
        projectName,
      );
      if (found && found !== slug) {
        slug = found;
        reading = await readSlug(slug, ctx);
        viaSearch = true;
      }
    }
  }

  const url = `${SKYNET}${slug}`;
  ctx.trace.step(`CertiK: /projects/${slug} → ${reading.kind}${viaSearch ? " (slug found via search)" : ""}`);

  switch (reading.kind) {
    case "missing":
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.NO_AUDITOR_RECORD_FOUND} — CertiK Skynet has no project page for "${projectName}"`,
        [evidence("CertiK Skynet", url, `HTTP 404 for /projects/${slug}`)],
        "No CertiK record found",
      );
    case "not-audited":
      return result(
        claim,
        "CONTRADICTED",
        `${REASON.AUDITOR_PAGE_SAYS_NOT_AUDITED} — CertiK's own project page for ${projectName} states "Not Audited By CertiK"`,
        [evidence("CertiK Skynet", url, reading.excerpt)],
        "CertiK's page says: Not Audited By CertiK",
      );
    case "audited":
      return result(
        claim,
        "VERIFIED",
        `${REASON.AUDIT_RECORD_FOUND} — ${reading.count} CertiK audit(s) listed${reading.lastDelivered ? `, last delivered ${reading.lastDelivered}` : ""}`,
        [evidence("CertiK Skynet", url, reading.excerpt)],
        AUDIT_SCOPE_QUALIFIER,
      );
    case "unreadable":
      return result(
        claim,
        "UNVERIFIED",
        `SOURCE_ERROR:certik — the project page matched neither the audited nor the not-audited pattern`,
        [evidence("CertiK Skynet", url, reading.excerpt || "(no audit section found)")],
      );
  }
}

/**
 * Same rule Sam chose for partnerships (Sep 23), for the same reason: an auditor's
 * domain names projects in many non-audit contexts — most dangerously, post-mortems of
 * a project's HACK. Name-on-domain alone would stamp "audited by X" ✅ on exactly the
 * projects that got exploited.
 */
export const AUDIT_LANGUAGE = /\b(audit(s|ed|ing)?|security (review|assessment)|smart contract review)\b/i;
const NEGATED_AUDIT = /\b(not|never|un)[\s-]?audited\b|\bwithout (an? )?(audit|security review)\b|\bno audit\b/i;

export type AuditPageFinding = { kind: "audit" | "mention"; sentence: string } | { kind: "absent" };

/** Pure: classify one auditor-domain page for one project. Exported for testing. */
export function classifyAuditPage(text: string, projectName: string): AuditPageFinding {
  let firstMention: string | null = null;
  for (const s of sentences(text)) {
    if (!mentionsName(s, projectName)) continue;
    if (AUDIT_LANGUAGE.test(s) && !NEGATED_AUDIT.test(s)) return { kind: "audit", sentence: s };
    firstMention ??= s;
  }
  return firstMention ? { kind: "mention", sentence: firstMention } : { kind: "absent" };
}

async function checkBySearch(
  claim: Claim,
  projectName: string,
  auditor: { id: string; names: string[]; domains: string[] },
  ctx: Ctx,
) {
  const searcher = ctx.search ?? createSearcher();
  ctx.budget.spend(`tavily:audit:${auditor.id}`);
  const results = await searcher.search(`"${projectName}" audit`, auditor.domains);

  let mention: { url: string; sentence: string } | null = null;
  for (const r of results) {
    if (!isOnDomain(r.url, auditor.domains)) continue;
    const finding = classifyAuditPage(`${r.title}\n${r.content}\n${r.rawContent ?? ""}`, projectName);
    if (finding.kind === "audit") {
      ctx.trace.step(`${auditor.names[0]}: audit of ${projectName} named at ${r.url}`);
      return result(
        claim,
        "VERIFIED",
        `${REASON.AUDIT_RECORD_FOUND} — ${auditor.names[0]}'s own site names ${projectName} in audit terms`,
        [evidence(`${auditor.names[0]} (auditor domain)`, r.url, finding.sentence)],
        AUDIT_SCOPE_QUALIFIER,
      );
    }
    if (finding.kind === "mention") mention ??= { url: r.url, sentence: finding.sentence };
  }

  if (mention) {
    ctx.trace.step(`${auditor.names[0]}: ${projectName} mentioned, but not as an audit`);
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.MENTION_ONLY} — ${auditor.names[0]}'s site mentions ${projectName}, but never as an audit it performed`,
      [evidence(`${auditor.names[0]} (auditor domain)`, mention.url, mention.sentence)],
      `Mentioned on ${auditor.domains[0]} — no audit language`,
    );
  }

  ctx.trace.step(`${auditor.names[0]}: no page names ${projectName}`);
  // §3: not finding a report is not proof there isn't one.
  return result(
    claim,
    "UNVERIFIED",
    `${REASON.NO_AUDITOR_RECORD_FOUND} — no page on ${auditor.domains.join(", ")} names ${projectName}`,
    [],
    `No ${auditor.names[0]} record found`,
  );
}

export async function checkAudit(claim: Claim, project: Project, ctx: Ctx) {
  const auditorName = typeof claim.params.auditor === "string" ? claim.params.auditor : "";
  const auditor = findAuditor(auditorName);

  if (!auditor) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.AUDITOR_NOT_IN_REGISTRY} — "${auditorName || "unnamed auditor"}" is not in the auditor registry`,
      [],
      "Auditor not supported in v1",
    );
  }

  if (!project.name) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NO_AUDITOR_RECORD_FOUND} — the announcement did not name the project, so there is nothing to look up`,
      [],
      "No project name",
    );
  }

  try {
    ctx.trace.step(`Checking ${auditor.names[0]} audit for ${project.name}`);
    if (auditor.checker === "certik") return await checkCertik(claim, project.name, ctx);
    return await checkBySearch(claim, project.name, auditor, ctx);
  } catch (err) {
    return failClosed(auditor.id, claim, err);
  }
}
