/**
 * Run the pipeline from the CLI against a fixture or any input — Progress.md Day 2.
 *
 *   pnpm fixture fixtures/sample1.txt
 *   pnpm fixture "https://x.com/i/status/20"
 *   pnpm fixture --text "NOVA is now listed on WEEX"
 *
 * With no ANTHROPIC_API_KEY it runs in --offline mode: ingest and the checkers still
 * run for real against live primary sources, using claims supplied by --claims instead
 * of the model. That keeps the deterministic half of the system testable without a key,
 * which is the half that decides verdicts.
 */
import { readFileSync } from "node:fs";

import { checkExchangeListing } from "../src/checkers/exchange/index.js";
import { checkOwnership } from "../src/checkers/ownership.js";
import type { Ctx } from "../src/checkers/types.js";
import { Budget } from "../src/lib/budget.js";
import { extract } from "../src/lib/extract.js";
import { ingest } from "../src/lib/ingest/index.js";
import { createLlm, llmConfigured } from "../src/lib/llm.js";
import type { CheckResult, Claim, Project } from "../src/lib/schema.js";
import { Trace } from "../src/lib/trace.js";

const STAMP = { VERIFIED: "[VERIFIED]", CONTRADICTED: "[CONTRADICTED]", UNVERIFIED: "[UNVERIFIED]" } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Claims to use when there is no API key, so checkers can still be exercised. */
function offlineClaims(text: string): { project: Project; claims: Claim[] } {
  const ticker = text.match(/\(([A-Z0-9]{2,10})\)/)?.[1];
  const contract = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const claims: Claim[] = [];

  for (const exchange of ["WEEX", "BingX", "Binance", "MEXC", "Bybit"]) {
    const quote = text.match(new RegExp(`[^.\\n]*\\b${exchange}\\b[^.\\n]*`, "i"))?.[0];
    if (quote) {
      claims.push({
        id: `c${claims.length + 1}`,
        type: "EXCHANGE_LISTING",
        quote: quote.trim(),
        params: { exchange, tense: /will be listed|coming soon/i.test(quote) ? "future" : "present" },
      });
    }
  }

  const renounced = text.match(/[^.\n]*renounced[^.\n]*/i)?.[0];
  if (renounced) {
    claims.push({
      id: `c${claims.length + 1}`,
      type: "OWNERSHIP_RENOUNCED",
      quote: renounced.trim(),
      params: {},
    });
  }

  return {
    project: { chain: "base", ...(ticker ? { ticker } : {}), ...(contract ? { contract } : {}) },
    claims,
  };
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const inline = arg("text");
  const target = inline ?? positional[0];

  if (!target) {
    console.error("usage: pnpm fixture <file|url> | --text \"...\"");
    process.exit(1);
  }

  const raw = inline ?? (/^https?:\/\//i.test(target) ? target : readFileSync(target, "utf8"));

  const trace = new Trace();
  trace.onStep((e) => console.log(`  · ${e.step}`));
  const ctx: Ctx = { budget: new Budget(12), trace, timeoutMs: 8_000 };

  console.log("\n=== INGEST");
  const ingested = await ingest(raw);
  console.log(`  kind: ${ingested.kind}${ingested.source ? ` (${ingested.source.label})` : ""}`);
  console.log(`  ${ingested.fetchedText.length} chars`);

  console.log("\n=== EXTRACT");
  let project: Project;
  let claims: Claim[];

  if (llmConfigured()) {
    const out = await extract(createLlm(), ingested.fetchedText);
    project = out.project;
    claims = out.claims;
    for (const d of out.dropped) console.log(`  dropped (${d.reason}): "${d.quote.slice(0, 60)}"`);
  } else {
    console.log("  ANTHROPIC_API_KEY not set — using offline claim detection");
    console.log("  (checkers below still run against real primary sources)");
    const out = offlineClaims(ingested.fetchedText);
    project = out.project;
    claims = out.claims;
  }

  console.log(`  project: ${JSON.stringify(project)}`);
  console.log(`  ${claims.length} claim(s)`);
  for (const c of claims) console.log(`    ${c.id} ${c.type}: "${c.quote.slice(0, 70)}"`);

  console.log("\n=== CHECK");
  const results: CheckResult[] = [];
  for (const claim of claims) {
    if (claim.type === "EXCHANGE_LISTING") {
      results.push(await checkExchangeListing(claim, project, ctx));
    } else if (claim.type === "OWNERSHIP_RENOUNCED") {
      results.push(await checkOwnership(claim, project, ctx));
    } else {
      console.log(`  · ${claim.type} has no checker yet (Day 3)`);
    }
  }

  console.log("\n=== RESULTS");
  for (const r of results) {
    const claim = claims.find((c) => c.id === r.claimId);
    console.log(`\n${STAMP[r.verdict]} ${claim?.type}`);
    console.log(`  claim    : "${claim?.quote.slice(0, 80)}"`);
    console.log(`  reason   : ${r.reason}`);
    if (r.qualifier) console.log(`  qualifier: ${r.qualifier}`);
    for (const e of r.evidence) {
      console.log(`  proof    : ${e.source} — ${e.url}`);
      console.log(`             "${e.excerpt.slice(0, 120)}"`);
    }
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\n=== ${counts.VERIFIED ?? 0} verified / ${counts.CONTRADICTED ?? 0} contradicted / ${counts.UNVERIFIED ?? 0} unverified` +
      `   (budget ${ctx.budget.spent}/12)`,
  );
}

main().catch((e) => {
  console.error("\nrun-fixture failed:", e);
  process.exit(1);
});
