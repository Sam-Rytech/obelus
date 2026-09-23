/**
 * spike-dexscreener — confirm the endpoint shapes that resolve.ts (contract lookup)
 * and §10.4 (LP locking) depend on.
 *
 * Finding (Sep 22): /latest/dex/search returns chainId, dexId, pairAddress,
 * baseToken.address, liquidity — everything both callers need.
 */
import { getJson, save, h, expect, done } from "./_spike";

const SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/base/";

const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";

type Pair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  liquidity?: { usd?: number };
};

async function main() {
  h("search?q=AERO");
  const search = await getJson<{ pairs: Pair[] }>(`${SEARCH}AERO`);
  save("dexscreener-search", search);

  const pairs = search.pairs ?? [];
  console.log(`  pairs: ${pairs.length}`);
  console.log(`  fields: ${Object.keys(pairs[0] ?? {}).join(", ")}`);

  const basePairs = pairs.filter((p) => p.chainId === "base");
  console.log(`  on Base: ${basePairs.length}`);
  for (const p of basePairs.slice(0, 5)) {
    console.log(
      `    ${p.dexId.padEnd(12)} ${p.baseToken.symbol}/${p.quoteToken.symbol}` +
        `  liq $${Math.round(p.liquidity?.usd ?? 0).toLocaleString()}` +
        `  labels=${JSON.stringify(p.labels ?? [])}  ${p.pairAddress}`,
    );
  }

  expect("results carry chainId so we can filter to Base", pairs.every((p) => Boolean(p.chainId)));
  expect("results carry baseToken.address (contract resolution)", pairs.every((p) => Boolean(p.baseToken?.address)));
  expect("results carry pairAddress (LP reads for §10.4)", pairs.every((p) => Boolean(p.pairAddress)));
  expect(
    "AERO resolves to the known Aerodrome token on Base",
    basePairs.some((p) => p.baseToken.address.toLowerCase() === AERO.toLowerCase()),
  );

  h("dex identification — which pairs are v2-style ERC-20 LP?");
  const dexIds = new Map<string, number>();
  for (const p of basePairs) {
    const key = `${p.dexId}${p.labels?.length ? ` [${p.labels.join(",")}]` : ""}`;
    dexIds.set(key, (dexIds.get(key) ?? 0) + 1);
  }
  console.log(`  ${[...dexIds].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  note: §10.4 only supports v2-style ERC-20 LP; v3 pairs -> LOCK_TYPE_NOT_SUPPORTED_V1`);

  h(`token-pairs/v1/base/${AERO.slice(0, 10)}...`);
  try {
    const tp = await getJson<Pair[]>(`${TOKEN_PAIRS}${AERO}`);
    save("dexscreener-token-pairs", tp);
    console.log(`  pairs for token: ${Array.isArray(tp) ? tp.length : "unexpected shape"}`);
    if (Array.isArray(tp) && tp[0]) {
      const top = [...tp].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      console.log(`  top by liquidity: ${top?.dexId} ${top?.pairAddress} $${Math.round(top?.liquidity?.usd ?? 0).toLocaleString()}`);
    }
  } catch (e) {
    console.log(`  token-pairs endpoint unavailable (${String(e).slice(0, 80)}) — search endpoint is sufficient`);
  }

  done(
    "DexScreener",
    "Works",
    `/latest/dex/search?q= returns chainId, dexId, pairAddress, baseToken.address, liquidity. ${basePairs.length} Base pairs for AERO. Basis for resolve.ts and §10.4 top-pair selection.`,
  );
}

main().catch((e) => {
  console.error("spike-dexscreener failed:", e);
  process.exit(1);
});
