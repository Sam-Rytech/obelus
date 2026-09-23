/**
 * Run the real pipeline from the CLI — Progress.md Day 2/3.
 *
 *   pnpm fixture fixtures/sample1.txt            model extraction (needs Anthropic credit)
 *   pnpm fixture fixtures/sample1.txt --offline  regex claim detection stands in for the model
 *   pnpm fixture "https://x.com/i/status/20"
 *   pnpm fixture --text "NOVA is now listed on WEEX" --offline
 *   add --save to store the report in Redis and print its /api/report URL
 *
 * --offline swaps ONLY the extractor. Ingest, the quote guard, contract resolution,
 * every checker against live primary sources, the summary and the hash all run for
 * real — which is the half of the system that decides verdicts.
 */
import { readFileSync } from "node:fs";

import { llmConfigured, StubLlm, type Llm } from "../src/lib/llm";
import { runPipeline } from "../src/lib/pipeline";
import { reportHash } from "../src/lib/hash";

const STAMP = { VERIFIED: "[VERIFIED]    ", CONTRADICTED: "[CONTRADICTED]", UNVERIFIED: "[UNVERIFIED]  " } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Crude stand-in for the model: enough to drive the checkers, never shipped. */
function offlineExtraction(text: string): string {
  const name = text.match(/^([A-Z][\w.]*(?: [A-Z][\w.]*)*) \(([A-Z0-9]{2,10})\)/m);
  const contract = text.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
  const sentence = (re: RegExp) => text.match(new RegExp(`[^.\\n]*${re.source}[^.\\n]*`, "i"))?.[0]?.trim();
  const claims: unknown[] = [];
  const add = (type: string, quote: string | undefined, params: Record<string, unknown>) => {
    if (quote) claims.push({ id: `c${claims.length + 1}`, type, quote, params });
  };

  for (const ex of ["WEEX", "BingX", "Binance", "MEXC", "Bybit", "OKX"]) {
    const q = sentence(new RegExp(`\\b${ex}\\b`));
    add("EXCHANGE_LISTING", q, { exchange: ex, tense: q && /will be listed|coming soon|next month/i.test(q) ? "future" : "present" });
  }
  const auditor = text.match(/audited by ([A-Z][A-Za-z]+)/)?.[1];
  add("AUDIT", auditor ? sentence(new RegExp(`audited by ${auditor}`)) : undefined, { auditor });
  add("OWNERSHIP_RENOUNCED", sentence(/renounced/), {});
  add("LIQUIDITY_LOCK", sentence(/liquidity is locked/), {});
  const partner = text.match(/partnership with ([A-Z][A-Za-z]+)/)?.[1];
  add("PARTNERSHIP", partner ? sentence(new RegExp(`partnership with ${partner}`)) : undefined, { partner });
  const tvl = text.match(/\$([\d,]+(?:\.\d+)?)/);
  const tvlQuote = sentence(/value locked|TVL/);
  if (tvl?.[1] && tvlQuote) add("TVL", tvlQuote, { amountUsd: Number(tvl[1].replace(/,/g, "")) });

  return JSON.stringify({
    project: { name: name?.[1] ?? null, ticker: name?.[2] ?? null, contract },
    claims,
  });
}

async function main() {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--text");
  const inline = arg("text");
  const target = inline ?? positional[0];
  if (!target) {
    console.error('usage: pnpm fixture <file|url> [--offline] [--save] | --text "..."');
    process.exit(1);
  }
  const input = inline ?? (/^https?:\/\//i.test(target) ? target : readFileSync(target, "utf8"));

  const offline = flag("offline") || !llmConfigured();
  let llm: Llm | undefined;
  if (offline) {
    // The stand-in needs the ingested text; for a file or --text that's the input itself.
    llm = new StubLlm([offlineExtraction(input)]);
    console.log("mode: OFFLINE extraction (regex stand-in for the model); everything else is live\n");
  } else {
    console.log(`mode: model extraction (${process.env.LLM_MODEL ?? "claude-sonnet-5"})\n`);
  }

  const started = Date.now();
  const report = await runPipeline(input, {
    llm,
    save: flag("save"),
    onTrace: (e) => console.log(`  · ${e.step}`),
  });

  console.log(`\n=== ${report.project.name ?? "?"} (${report.project.ticker ?? "?"})` +
    `${report.project.contract ? ` ${report.project.contract} [${report.project.contractSource}]` : ""}`);

  for (const r of report.results) {
    const claim = report.claims.find((c) => c.id === r.claimId);
    console.log(`\n${STAMP[r.verdict]} ${claim?.type}`);
    console.log(`  claim    : "${claim?.quote.replace(/\s+/g, " ").slice(0, 80)}"`);
    console.log(`  reason   : ${r.reason}`);
    if (r.qualifier) console.log(`  qualifier: ${r.qualifier}`);
    for (const e of r.evidence) console.log(`  proof    : ${e.source} — ${e.url}`);
  }

  console.log(`\n=== SUMMARY\n  ${report.summary}`);
  console.log(`\n=== report ${report.id}  hash ${report.reportHash}`);
  console.log(`  hash recomputes from the stored shape: ${reportHash(JSON.parse(JSON.stringify(report))) === report.reportHash}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s total`);
  if (flag("save")) console.log(`  stored — GET /api/report/${report.id}`);
}

main().catch((e) => {
  console.error("\nrun-fixture failed:", e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : e);
  process.exit(1);
});
