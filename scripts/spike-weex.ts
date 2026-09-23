/**
 * spike-weex — establish that WEEX gives BOTH structured markets and contract
 * addresses, which makes it the primary listing checker (§10.1).
 *
 * Finding (Sep 22):
 *  - v2/public/products returns bare strings ("MRVLONUSDT_SPBL") with no base/quote
 *    separator, so ticker matching is undecidable. DO NOT USE IT.
 *  - v3/exchangeInfo returns baseAsset/quoteAsset/status (TRADING|HALT).
 *  - v3/coins returns networkList[] with contractAddress per network.
 *    AERO on BASE -> 0x940181a94a35a4569e4529a3cdfb74e38fd98631, which matches
 *    DexScreener's baseToken.address exactly.
 */
import { getJson, save, h, expect, done } from "./_spike";

const PRODUCTS_V2 = "https://api-spot.weex.com/api/v2/public/products";
const EXCHANGE_INFO = "https://api-spot.weex.com/api/v3/exchangeInfo";
const COINS = "https://api-spot.weex.com/api/v3/coins";

const AERO_ON_BASE = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";

type Market = { symbol: string; baseAsset: string; quoteAsset: string; status: string };
type Network = { network: string; contractAddress?: string; contractAddressUrl?: string };
type Coin = { coin: string; name: string; networkList: Network[] };

async function main() {
  h("v2/public/products — why it is unusable");
  const v2 = await getJson<{ data: string[] }>(PRODUCTS_V2);
  save("weex-products-v2", v2);
  console.log(`  entries: ${v2.data.length}, type: ${typeof v2.data[0]}`);
  console.log(`  sample: ${v2.data.slice(0, 4).join(", ")}`);
  expect(
    "v2 returns bare strings with no base/quote separator",
    typeof v2.data[0] === "string" && !/[-_/]USDT/.test(v2.data[0] ?? ""),
    "MRVLONUSDT -> MRVLON or MRVLONU? undecidable, so CONTRADICTED would be unsound",
  );

  h("v3/exchangeInfo — structured markets");
  const info = await getJson<{ symbols: Market[] }>(EXCHANGE_INFO);
  save("weex-exchangeinfo", info);
  const markets = info.symbols;
  const byStatus = new Map<string, number>();
  for (const m of markets) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
  console.log(`  symbols: ${markets.length}`);
  console.log(`  fields: ${Object.keys(markets[0] ?? {}).slice(0, 8).join(", ")}, ...`);
  console.log(`  status: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  expect(
    "baseAsset/quoteAsset are present (no string splitting needed)",
    markets.every((m) => Boolean(m.baseAsset && m.quoteAsset)),
  );
  const aero = markets.find((m) => m.symbol === "AEROUSDT");
  expect("AEROUSDT parses to base AERO / quote USDT", aero?.baseAsset === "AERO" && aero?.quoteAsset === "USDT");
  expect("AEROUSDT is TRADING", aero?.status === "TRADING", `status=${aero?.status}`);
  const ambiguous = markets.find((m) => m.symbol === "MRVLONUSDT");
  console.log(`  MRVLONUSDT -> base ${ambiguous?.baseAsset}, quote ${ambiguous?.quoteAsset} (v2 could not tell us this)`);

  h("v3/coins — contract addresses per network");
  const coins = await getJson<Coin[]>(COINS);
  save("weex-coins", coins);
  const withContract = coins.filter((c) => c.networkList.some((n) => n.contractAddress));
  console.log(`  coins: ${coins.length}, exposing a contract address: ${withContract.length}`);
  console.log(`  networkList fields: ${Object.keys(coins[0]?.networkList[0] ?? {}).join(", ")}`);

  const aeroCoin = coins.find((c) => c.coin === "AERO");
  const baseNet = aeroCoin?.networkList.find((n) => n.network.toUpperCase() === "BASE");
  console.log(`  AERO on BASE -> ${baseNet?.contractAddress}`);
  expect(
    "AERO's BASE contract matches the known Aerodrome token address",
    baseNet?.contractAddress?.toLowerCase() === AERO_ON_BASE,
    `got ${baseNet?.contractAddress}`,
  );
  expect(
    "a meaningful share of coins carry an address",
    withContract.length > 100,
    `${withContract.length}/${coins.length} — the rest fall back to the qualified VERIFIED branch`,
  );

  const baseCoins = coins.filter((c) =>
    c.networkList.some((n) => n.network.toUpperCase() === "BASE" && n.contractAddress),
  );
  console.log(`  coins with a BASE-network contract: ${baseCoins.length}`);

  done(
    "WEEX",
    "Works — and is the primary listing checker",
    `Use **v3/exchangeInfo** (${markets.length} symbols, baseAsset/quoteAsset/status TRADING|HALT), NOT v2/public/products (bare strings, ambiguous). **v3/coins exposes contractAddress** (${withContract.length}/${coins.length} coins; ${baseCoins.length} on BASE) — the only exchange source that can confirm token identity and catch DIFFERENT_TOKEN_SAME_TICKER.`,
  );
}

main().catch((e) => {
  console.error("spike-weex failed:", e);
  process.exit(1);
});
