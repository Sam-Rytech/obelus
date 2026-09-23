/**
 * TVL checker — architecture §10.6.
 *
 * Source: DefiLlama. Per-claim path is /tvl/<slug> (17 bytes, a bare number), never
 * /protocols (8.9 MB) or /protocol/<slug> (13.9 MB) — measured Sep 22. /protocols is
 * used only as a fallback name→slug map, cached 24 h.
 *
 * Rules:
 *   within ±25% of the claimed figure                       -> VERIFIED
 *   claim is a FLOOR ("crossed", "over", "more than", ...)
 *     and current TVL >= 75% of it                          -> VERIFIED
 *   otherwise                                               -> CONTRADICTED (show actual)
 *   not on DefiLlama                                        -> UNVERIFIED NOT_ON_DEFILLAMA
 *   DefiLlama unreachable                                   -> UNVERIFIED SOURCE_ERROR
 *
 * The floor rule is an addition to §10.6: "TVL has crossed $4M" is true of a protocol
 * holding $40M, and a ±25% band alone would stamp it ❌. Detected from the quote text
 * by a fixed word list — code decides.
 *
 * The last two lines are deliberately different: "DefiLlama doesn't list it" is an
 * answer; "we couldn't reach DefiLlama" is not (the Day-2 lesson).
 */
import { cached, TTL } from "../lib/cache";
import { REASON, type Claim, type Project } from "../lib/schema";
import { evidence, failClosed, result, type Ctx } from "./types";

const TVL = "https://api.llama.fi/tvl/";
const PROTOCOLS = "https://api.llama.fi/protocols";
export const TOLERANCE = 0.25;

/** Wording that makes a TVL figure a lower bound rather than a point estimate. */
export const FLOOR_WORDING =
  /\b(crossed|cross(es|ing)?|surpass(ed|es|ing)?|exceed(ed|s|ing)?|over|above|more than|topped|tops|hit|reached|passed|beyond)\b/i;

export function tvlSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Generic trailing words projects add to their names but DefiLlama often omits. */
const GENERIC_SUFFIX = /\s+(finance|protocol|labs|network|exchange|dao|app)$/i;

export type NameVariant = { slug: string; key: string; exact: boolean };

/**
 * The full name first, then the name without a generic suffix ("Aerodrome Finance" is
 * DefiLlama's "aerodrome" — missed in the first live run). A variant is only `exact`
 * if it is the full name; see checkTvl for why that matters.
 */
export function nameVariants(name: string): NameVariant[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: NameVariant[] = [{ slug: tvlSlug(name), key: key(name), exact: true }];
  const short = name.trim().replace(GENERIC_SUFFIX, "");
  if (short !== name.trim() && short.length >= 2) out.push({ slug: tvlSlug(short), key: key(short), exact: false });
  return out;
}

export function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export type TvlDecision = { verdict: "VERIFIED" | "CONTRADICTED"; reason: string };

/** Pure: compare a claimed figure to the actual one. Exported for exhaustive testing. */
export function decideTvl(claimed: number, actual: number, quote: string): TvlDecision {
  const ratio = actual / claimed;
  const within = Math.abs(ratio - 1) <= TOLERANCE;
  const isFloor = FLOOR_WORDING.test(quote);

  if (within) {
    return { verdict: "VERIFIED", reason: `${REASON.TVL_WITHIN_TOLERANCE} — ${formatUsd(actual)} is within ±25% of the claimed ${formatUsd(claimed)}` };
  }
  if (isFloor && ratio >= 1 - TOLERANCE) {
    return { verdict: "VERIFIED", reason: `${REASON.TVL_WITHIN_TOLERANCE} — the claim is a floor ("${quote.match(FLOOR_WORDING)?.[0]}") and current TVL ${formatUsd(actual)} meets it` };
  }
  return {
    verdict: "CONTRADICTED",
    reason: `${REASON.TVL_OUTSIDE_TOLERANCE} — DefiLlama reports ${formatUsd(actual)}, ${ratio < 1 ? `${Math.round((1 - ratio) * 100)}% below` : `${Math.round((ratio - 1) * 100)}% above`} the claimed ${formatUsd(claimed)}`,
  };
}

/** A /tvl response is either a bare number or "Protocol not found". */
async function fetchTvl(slug: string, ctx: Ctx): Promise<number | null> {
  ctx.budget.spend("defillama:tvl");
  const res = await fetch(`${TVL}${encodeURIComponent(slug)}`, {
    headers: { "user-agent": "ObelusBot/0.1 (crypto announcement fact-checker)" },
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  if (res.status >= 500) throw new Error(`DefiLlama returned HTTP ${res.status}`);
  const text = (await res.text()).trim();
  const n = Number(text);
  if (text !== "" && Number.isFinite(n)) return n;
  // Only DefiLlama's explicit answer counts as "not listed"; anything else is an error.
  if (/not found/i.test(text) || res.status === 400 || res.status === 404) return null;
  throw new Error(`DefiLlama returned an unexpected body: ${text.slice(0, 60)}`);
}

async function slugMap(ctx: Ctx): Promise<Record<string, string>> {
  return cached("defillama:slugmap", TTL.DEFILLAMA_SLUGS, async () => {
    ctx.budget.spend("defillama:protocols");
    const res = await fetch(PROTOCOLS, { signal: AbortSignal.timeout(Math.max(ctx.timeoutMs, 15_000)) });
    if (!res.ok) throw new Error(`DefiLlama /protocols returned HTTP ${res.status}`);
    const list = (await res.json()) as { name?: string; slug?: string }[];
    // Store only the map (~330 KB); the raw list is 8.9 MB, over Upstash's 1 MB value cap.
    const map: Record<string, string> = {};
    for (const p of list) {
      if (p.name && p.slug) map[p.name.toLowerCase().replace(/[^a-z0-9]/g, "")] = p.slug;
    }
    return map;
  });
}

export async function checkTvl(claim: Claim, project: Project, ctx: Ctx) {
  const claimed = typeof claim.params.amountUsd === "number" ? claim.params.amountUsd : NaN;
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return result(claim, "UNVERIFIED", `${REASON.NOT_ON_DEFILLAMA} — no usable TVL figure was extracted`, []);
  }
  if (!project.name) {
    return result(claim, "UNVERIFIED", `${REASON.NOT_ON_DEFILLAMA} — the announcement did not name the project`, [], "No project name");
  }

  try {
    const variants = nameVariants(project.name);
    const tvlOf = (s: string) => cached(`defillama:tvl:${s}`, TTL.EXCHANGE_SYMBOLS, () => fetchTvl(s, ctx));

    let slug = variants[0]!.slug;
    let exact = true;
    let actual: number | null = null;

    // 1. Direct slugs, full name first.
    for (const v of variants) {
      actual = await tvlOf(v.slug);
      if (actual !== null) {
        slug = v.slug;
        exact = v.exact;
        break;
      }
    }

    // 2. DefiLlama's own name→slug map, full name first.
    if (actual === null) {
      const map = await slugMap(ctx);
      for (const v of variants) {
        const mapped = map[v.key];
        if (!mapped || variants.some((x) => x.slug === mapped)) continue; // already tried
        actual = await tvlOf(mapped);
        if (actual !== null) {
          slug = mapped;
          exact = v.exact;
          break;
        }
      }
    }

    const page = `https://defillama.com/protocol/${slug}`;
    const fetchedAt = new Date().toISOString();

    if (actual === null) {
      ctx.trace.step(`DefiLlama: ${project.name} not listed`);
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.NOT_ON_DEFILLAMA} — DefiLlama has no protocol matching "${project.name}"`,
        [evidence("DefiLlama", `${TVL}${slug}`, "Protocol not found")],
        "Not tracked by DefiLlama",
      );
    }

    const decision = decideTvl(claimed, actual, claim.quote);
    ctx.trace.step(
      `DefiLlama: "${slug}"${exact ? "" : " (matched by shortened name)"} TVL ${formatUsd(actual)} vs claimed ${formatUsd(claimed)}`,
    );
    const ev = [evidence("DefiLlama", page, `Current TVL for ${slug}: ${formatUsd(actual)} (${actual.toFixed(0)} USD) at ${fetchedAt}`)];
    // Claims can be dated, so always show what DefiLlama says now and when (§10.6).
    const now = `DefiLlama now: ${formatUsd(actual)} (fetched ${fetchedAt.slice(0, 16).replace("T", " ")} UTC)`;

    // Matched through a SHORTENED name: DefiLlama's "Nova" may not be "Nova Finance".
    // Agreement is still good evidence; disagreement may just be a different protocol,
    // so it can't be pinned on this project (§3) — same rule as inferred contracts.
    if (!exact && decision.verdict === "CONTRADICTED") {
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.TVL_OUTSIDE_TOLERANCE} — DefiLlama's "${slug}" (matched by shortened name) reports ${formatUsd(actual)}, but it may be a different protocol from ${project.name}`,
        ev,
        `${now} — name match uncertain`,
      );
    }
    return result(
      claim,
      decision.verdict,
      decision.reason,
      ev,
      exact ? now : `${now} — matched DefiLlama's "${slug}"`,
    );
  } catch (err) {
    return failClosed("defillama", claim, err);
  }
}
