/**
 * spike-tavily — deferred from Day 1 until a key existed.
 *
 * Tavily's role shrank after Day 1: CertiK is read by direct slug, so Tavily is used
 * only for (a) PARTNERSHIP — search restricted to the partner's own domains, §10.5 —
 * and (b) the audit fallback when a direct CertiK slug 404s.
 *
 * The property that matters is that `include_domains` is a HARD restriction. The
 * partnership rule treats "a page on a partner-controlled domain mentions the project"
 * as VERIFIED, so a single off-domain result leaking through would let any blog post
 * or press-release mirror verify a partnership. That is asserted, not assumed.
 *
 * Costs credits (free tier: 1,000/month). This spike makes 3 basic searches.
 */
import { tavily } from "@tavily/core";

import { h, expect, done, save } from "./_spike";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A result is on-domain if its host is the domain or a subdomain of it. */
function onDomain(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

async function main() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  const client = tavily({ apiKey });

  const captured: Record<string, unknown>[] = [];

  // --- 1. Partnership shape: a real, well-documented partner relationship --------
  h("Partnership search — Aave on chain.link");
  const partnerDomains = ["chain.link", "blog.chain.link"];
  let t0 = Date.now();
  const partner = await client.search('"Aave"', {
    includeDomains: partnerDomains,
    maxResults: 5,
    searchDepth: "basic",
  });
  const partnerMs = Date.now() - t0;
  captured.push({ query: "Aave @ chain.link", results: partner.results });

  console.log(`  ${partner.results.length} results in ${partnerMs}ms`);
  for (const r of partner.results) {
    console.log(`    ${onDomain(r.url, partnerDomains) ? "on " : "OFF"} ${r.url}`);
  }
  expect("returns results for a real partner relationship", partner.results.length > 0);
  expect(
    "include_domains is a hard restriction — every result is on a partner domain",
    partner.results.every((r) => onDomain(r.url, partnerDomains)),
  );
  const mentions = partner.results.filter((r) => /\baave\b/i.test(`${r.title} ${r.content}`));
  expect(
    "result content carries the project name, which is what §10.5 matches on",
    mentions.length > 0,
    `${mentions.length}/${partner.results.length} mention "Aave"`,
  );
  console.log(`  fields: ${Object.keys(partner.results[0] ?? {}).join(", ")}`);

  // --- 2. Absence: a fabricated project must return nothing on-domain ------------
  h("Partnership search — a project that does not exist");
  t0 = Date.now();
  const fake = await client.search('"Zyxqvort Protocol"', {
    includeDomains: partnerDomains,
    maxResults: 5,
    searchDepth: "basic",
  });
  captured.push({ query: "fake @ chain.link", results: fake.results });
  const fakeHits = fake.results.filter((r) => /zyxqvort/i.test(`${r.title} ${r.content}`));
  console.log(`  ${fake.results.length} results, ${fakeHits.length} actually mention the name (${Date.now() - t0}ms)`);
  // Tavily may return loosely-related pages; the checker must match the NAME in the
  // content, not trust that any result at all means a mention.
  expect(
    "no result mentions a fabricated project — so the name match, not result count, must decide",
    fakeHits.length === 0,
    fake.results.length > 0 ? `${fake.results.length} unrelated result(s) returned — result count alone would false-positive` : "",
  );

  // --- 3. CertiK fallback: find a Skynet project page by name --------------------
  h("CertiK fallback — locate a Skynet slug by project name");
  t0 = Date.now();
  const certik = await client.search("PancakeSwap", {
    includeDomains: ["skynet.certik.com"],
    maxResults: 5,
    searchDepth: "basic",
  });
  captured.push({ query: "PancakeSwap @ skynet", results: certik.results });
  const slugs = certik.results
    .map((r) => r.url.match(/skynet\.certik\.com\/projects\/([a-z0-9-]+)/i)?.[1])
    .filter((s): s is string => Boolean(s));
  console.log(`  ${certik.results.length} results in ${Date.now() - t0}ms; project slugs: ${[...new Set(slugs)].join(", ") || "none"}`);
  expect("a Skynet /projects/<slug> URL is recoverable from results", slugs.length > 0);

  save("tavily", captured);

  done(
    "Tavily",
    "Works — include_domains is a hard restriction",
    `3 basic searches (~3 credits). Partnership: "Aave" on chain.link -> ${partner.results.length} results, all on-domain, ${mentions.length} mention the name, ${partnerMs}ms. Fabricated project -> ${fake.results.length} results, ${fakeHits.length} mention it${fake.results.length > 0 ? " — **so the checker must match the project name in the content; result count alone would false-positive**" : ""}. CertiK fallback recovers slug(s): ${[...new Set(slugs)].join(", ") || "none"}. Result fields: url, title, content, score.`,
  );
}

main().catch((e) => {
  console.error("spike-tavily failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
