/**
 * Run real announcements through the LIVE site, exactly as a visitor would — Day 5.
 *
 *   pnpm spike scripts/run-batch.ts fixtures/real/inputs.json
 *
 * Posts each input to PUBLIC_BASE_URL/api/check (with the operator token so the public
 * rate limit doesn't apply), follows the SSE stream, fetches the stored report, and
 * writes fixtures/real/results.json plus a totals table for the submission (§19.5).
 * Receipts are written by the site itself, exactly as for any visitor.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { tally } from "../src/lib/summary";

type Input = { label: string; input: string; kind: "press-release" | "news" | "exchange" | "project" };
type Row = {
  label: string;
  kind: Input["kind"];
  input: string;
  reportId?: string;
  project?: string;
  claims?: number;
  verified?: number;
  contradicted?: number;
  unverified?: number;
  notCheckable?: number;
  sourceErrors?: number;
  seconds: number;
  error?: string;
  contradictions?: string[];
};

const BASE = (process.env.BATCH_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const ADMIN = process.env.ADMIN_TOKEN ?? "";

async function runOne(input: string): Promise<{ reportId?: string; error?: string }> {
  const res = await fetch(`${BASE}/api/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-obelus-admin": ADMIN },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(75_000),
  });
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => null)) as { message?: string } | null;
    return { error: `HTTP ${res.status}: ${b?.message ?? ""}` };
  }
  const text = await res.text();
  for (const block of text.split("\n\n")) {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!event || !data) continue;
    const payload = JSON.parse(data) as { reportId?: string; message?: string; code?: string };
    if (event === "done") return { reportId: payload.reportId };
    if (event === "error") return { error: `${payload.code}: ${payload.message}` };
  }
  return { error: "stream ended without a result" };
}

async function main() {
  const file = process.argv[2] ?? "fixtures/real/inputs.json";
  if (!BASE.startsWith("http")) throw new Error("set PUBLIC_BASE_URL (or BATCH_BASE_URL) to the site");
  if (!ADMIN) console.warn("ADMIN_TOKEN not set — the public 10/hour rate limit will apply");

  const inputs = JSON.parse(readFileSync(file, "utf8")) as Input[];
  const rows: Row[] = [];

  for (const [i, item] of inputs.entries()) {
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${inputs.length}] ${item.label.slice(0, 60)} … `);
    const { reportId, error } = await runOne(item.input).catch((e: unknown) => ({
      reportId: undefined,
      error: e instanceof Error ? e.message : String(e),
    }));
    const seconds = Math.round((Date.now() - t0) / 100) / 10;

    if (!reportId) {
      console.log(`failed (${error})`);
      rows.push({ label: item.label, kind: item.kind, input: item.input, seconds, error });
      continue;
    }

    const report = (await (await fetch(`${BASE}/api/report/${reportId}`)).json()) as {
      project: { name?: string; ticker?: string };
      claims: { id: string; quote: string }[];
      results: { claimId: string; verdict: string; reason: string }[];
    };
    const t = tally(report.results as { verdict: "VERIFIED" | "CONTRADICTED" | "UNVERIFIED"; reason: string }[]);
    const row: Row = {
      label: item.label,
      kind: item.kind,
      input: item.input,
      reportId,
      project: [report.project.name, report.project.ticker && `(${report.project.ticker})`].filter(Boolean).join(" "),
      claims: report.claims.length,
      verified: t.verified,
      contradicted: t.contradicted,
      unverified: t.unverified,
      notCheckable: t.notCheckable,
      sourceErrors: report.results.filter((r) => r.reason.startsWith("SOURCE_ERROR")).length,
      seconds,
      contradictions: report.results
        .filter((r) => r.verdict === "CONTRADICTED")
        .map((r) => `"${report.claims.find((c) => c.id === r.claimId)?.quote.slice(0, 70)}" — ${r.reason.split(" — ")[1]?.slice(0, 90)}`),
    };
    rows.push(row);
    console.log(`${row.claims} claims: ${row.verified}✓ ${row.contradicted}✗ ${row.unverified}? ${row.notCheckable}— (${seconds}s) ${BASE}/r/${reportId}`);

    // Stay well inside the free extractors' per-minute token limits.
    await new Promise((r) => setTimeout(r, 4_000));
  }

  writeFileSync("fixtures/real/results.json", `${JSON.stringify({ ranAt: new Date().toISOString(), site: BASE, rows }, null, 2)}\n`);

  const ok = rows.filter((r) => r.reportId);
  const sum = (k: "claims" | "verified" | "contradicted" | "unverified" | "notCheckable" | "sourceErrors") =>
    ok.reduce((a, r) => a + (r[k] ?? 0), 0);
  console.log(`\n=== ${ok.length}/${rows.length} announcements checked`);
  const checkable = sum("claims") - sum("notCheckable");
  console.log(`    claims ${sum("claims")} (${checkable} checkable): ${sum("verified")} verified, ${sum("contradicted")} contradicted, ${sum("unverified")} unverified, ${sum("notCheckable")} not checkable yet`);
  console.log(`    of the unverified, ${sum("sourceErrors")} were a source being unreachable`);
  console.log(`    median ${ok.map((r) => r.seconds).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? "-"}s per check`);
  for (const r of rows.filter((x) => x.contradictions?.length)) {
    console.log(`\n  ✗ ${r.project} — ${BASE}/r/${r.reportId}`);
    for (const c of r.contradictions!) console.log(`      ${c}`);
  }
}

main().catch((e) => {
  console.error("run-batch failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
