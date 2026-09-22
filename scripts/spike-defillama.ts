/**
 * spike-defillama — find a TVL endpoint that fits in a serverless request.
 *
 * Finding (Sep 22): /protocols is 4.4 MB and /protocol/<slug> is 13.9 MB (full TVL
 * history) — neither belongs in a per-claim path inside the 60 s budget.
 * /tvl/<slug> returns the bare current number in ~17 bytes.
 */
import { save, h, expect, done, UA } from "./_spike.js";

const TVL = "https://api.llama.fi/tvl/";
const PROTOCOLS = "https://api.llama.fi/protocols";
const PROTOCOL = "https://api.llama.fi/protocol/";

async function measure(url: string): Promise<{ bytes: number; body: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  return { bytes: body.length, body };
}

async function main() {
  h("Payload sizes — why /protocols cannot be the per-claim path");

  const tvl = await measure(`${TVL}aerodrome`);
  console.log(`  /tvl/aerodrome        ${String(tvl.bytes).padStart(9)} B   ${tvl.body.slice(0, 40)}`);

  const protocols = await measure(PROTOCOLS);
  console.log(`  /protocols            ${String(protocols.bytes).padStart(9)} B   (${(protocols.bytes / 1e6).toFixed(1)} MB)`);

  const protocol = await measure(`${PROTOCOL}aerodrome`);
  console.log(`  /protocol/aerodrome   ${String(protocol.bytes).padStart(9)} B   (${(protocol.bytes / 1e6).toFixed(1)} MB)`);

  expect("/tvl/<slug> is tiny enough for a per-claim call", tvl.bytes < 100, `${tvl.bytes} B`);
  expect("/tvl/<slug> returns a bare number", Number.isFinite(Number(tvl.body)), tvl.body.slice(0, 40));
  expect("/protocols is too large for a per-claim call", protocols.bytes > 1e6, `${(protocols.bytes / 1e6).toFixed(1)} MB`);
  expect("/protocol/<slug> is even larger — never use it", protocol.bytes > protocols.bytes);

  h("Slug fallback map — built from /protocols, cached 24 h");
  type P = { name: string; slug: string; tvl: number | null; chains: string[] };
  const list = JSON.parse(protocols.body) as P[];
  console.log(`  protocols: ${list.length}`);
  console.log(`  fields: ${Object.keys(list[0] ?? {}).slice(0, 10).join(", ")}, ...`);

  const map = new Map<string, string>();
  for (const p of list) if (p.name && p.slug) map.set(p.name.toLowerCase(), p.slug);
  save("defillama-slugmap", Object.fromEntries([...map].slice(0, 200)));
  console.log(`  name -> slug entries: ${map.size}`);

  const baseProtocols = list.filter((p) => p.chains?.includes("Base"));
  console.log(`  protocols on Base: ${baseProtocols.length}`);

  h("Miss behaviour — what a bad slug returns");
  const miss = await measure(`${TVL}zzzz-nonexistent-protocol-xyz`);
  console.log(`  bad slug -> ${miss.bytes} B: ${miss.body.slice(0, 80)}`);
  expect("a miss is distinguishable from a number", !Number.isFinite(Number(miss.body)));

  done(
    "DefiLlama",
    "Works — use /tvl/<slug>",
    `**/tvl/<slug> = ${tvl.bytes} B** (bare number) vs /protocols ${(protocols.bytes / 1e6).toFixed(1)} MB and /protocol/<slug> ${(protocol.bytes / 1e6).toFixed(1)} MB. Per-claim path is /tvl; /protocols only as a cached name->slug map (${map.size} entries, ${baseProtocols.length} on Base).`,
  );
}

main().catch((e) => {
  console.error("spike-defillama failed:", e);
  process.exit(1);
});
