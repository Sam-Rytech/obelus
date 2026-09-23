/**
 * PARTNERSHIP checker — architecture §10.5, tightened Sep 23.
 *
 * Only the partner's OWN domain can confirm a partnership. But being mentioned there is
 * not the same as being partnered with: the Sep 23 Tavily spike found that every Aave
 * hit on chain.link was a Chainlink price-feed page. Under the original rule (name on a
 * partner page = VERIFIED), any token with a Chainlink feed would pass "partnered with
 * Chainlink" — a free ✅ for a scammer.
 *
 * Rule, decided with Sam on Sep 23:
 *   VERIFIED     a sentence on a partner-domain page contains BOTH the project name AND
 *                partnership language (fixed keyword list below — code decides, not a model)
 *   UNVERIFIED   MENTION_ONLY — the name appears on the partner's site, but never in
 *                partnership terms; the page is still linked so the user can judge
 *   UNVERIFIED   NO_PARTNER_CONFIRMATION — the partner's site doesn't name the project
 *
 * NEVER CONTRADICTED (§10.5): a partner not announcing a partnership is not proof there
 * isn't one.
 */
import { REASON, type Claim, type Project } from "../lib/schema";
import { createSearcher, isOnDomain } from "../lib/search";
import { findPartner } from "../registry/index";
import { nameRegex, sentences } from "./text";
import { evidence, failClosed, result, type Ctx } from "./types";

/** Fixed, auditable list. Changing it changes verdicts, so it is tested. */
export const PARTNERSHIP_LANGUAGE =
  /\b(partner(s|ed|ing|ship|ships)?|collaborat\w*|integrat\w*|join(s|ed|ing)?\s+forces)\b/i;

export type PageFinding =
  | { kind: "partnership"; sentence: string }
  | { kind: "mention"; sentence: string }
  | { kind: "absent" };

/** Pure: classify one page's text for one project. Exported for exhaustive testing. */
export function classifyPage(text: string, projectName: string): PageFinding {
  const name = nameRegex(projectName);
  if (!name) return { kind: "absent" };

  let firstMention: string | null = null;
  for (const s of sentences(text)) {
    if (!name.test(s)) continue;
    // Both signals must be in the SAME sentence. A price-feed page can mention
    // "AAVE / USD" in one place and "integrate this feed" in another.
    if (PARTNERSHIP_LANGUAGE.test(s)) return { kind: "partnership", sentence: s };
    firstMention ??= s;
  }
  return firstMention ? { kind: "mention", sentence: firstMention } : { kind: "absent" };
}

export async function checkPartnership(claim: Claim, project: Project, ctx: Ctx) {
  const partnerName = typeof claim.params.partner === "string" ? claim.params.partner : "";
  const partner = findPartner(partnerName);

  if (!partner) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.PARTNER_NOT_IN_REGISTRY} — "${partnerName || "unnamed partner"}" is not in the partner registry, so Obelus doesn't know which domain speaks for them`,
      [],
      "Partner not supported in v1",
    );
  }

  if (!project.name) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NO_PARTNER_CONFIRMATION} — the announcement did not name the project`,
      [],
      "No project name",
    );
  }

  try {
    const searcher = ctx.search ?? createSearcher();
    ctx.trace.step(`Searching ${partner.domains.join(", ")} for ${project.name}`);
    ctx.budget.spend(`tavily:partner:${partner.id}`);
    const results = await searcher.search(`"${project.name}"`, partner.domains);

    let mention: { url: string; sentence: string } | null = null;
    for (const r of results) {
      if (!isOnDomain(r.url, partner.domains)) continue;
      const finding = classifyPage(`${r.title}\n${r.content}\n${r.rawContent ?? ""}`, project.name);

      if (finding.kind === "partnership") {
        ctx.trace.step(`${partner.names[0]}: partnership language at ${r.url}`);
        return result(
          claim,
          "VERIFIED",
          `${REASON.PARTNER_CONFIRMED} — ${partner.names[0]}'s own site names ${project.name} in partnership terms`,
          [evidence(`${partner.names[0]} (partner domain)`, r.url, finding.sentence)],
        );
      }
      if (finding.kind === "mention") mention ??= { url: r.url, sentence: finding.sentence };
    }

    if (mention) {
      ctx.trace.step(`${partner.names[0]}: ${project.name} mentioned, but not as a partner`);
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.MENTION_ONLY} — ${partner.names[0]}'s site mentions ${project.name}, but never in partnership terms`,
        [evidence(`${partner.names[0]} (partner domain)`, mention.url, mention.sentence)],
        `Mentioned on ${partner.domains[0]} — no partnership language`,
      );
    }

    ctx.trace.step(`${partner.names[0]}: no page names ${project.name}`);
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NO_PARTNER_CONFIRMATION} — nothing on ${partner.domains.join(", ")} names ${project.name}`,
      [],
      `${partner.names[0]} has not confirmed this`,
    );
  } catch (err) {
    return failClosed(`partner:${partner.id}`, claim, err);
  }
}
