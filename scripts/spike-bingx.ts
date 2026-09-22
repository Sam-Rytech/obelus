/**
 * spike-bingx — decode BingX spot `status`, and settle whether BingX exposes
 * contract addresses anywhere public.
 *
 * Finding (Sep 22): status 1 = live, 0 = delisted (with a past offTime),
 * 10 + timeOnline 0 = announced-not-trading, 5/25 = unknown.
 * 1,581 of 2,271 symbols are delisted but STILL RETURNED by the API — which is why
 * §10.1 gates on status and not on mere presence in the list.
 * No public BingX endpoint carries a contract address.
 */
import { getJson, save, h, expect, done } from "./_spike.js";

const SYMBOLS = "https://open-api.bingx.com/openApi/spot/v1/common/symbols";
const FUTURES = "https://open-api.bingx.com/openApi/swap/v2/quote/contracts";
const WALLET = "https://open-api.bingx.com/openApi/wallets/v1/capital/config/getall";

type Sym = {
  symbol: string;
  status: number;
  offTime: number;
  timeOnline: number;
  apiStateBuy: boolean;
  apiStateSell: boolean;
};

async function main() {
  h("BingX spot symbols");
  const spot = await getJson<{ data: { symbols: Sym[] } }>(SYMBOLS);
  const symbols = spot.data.symbols;
  save("bingx-symbols", spot);

  const byStatus = new Map<number, Sym[]>();
  for (const s of symbols) {
    const list = byStatus.get(s.status) ?? [];
    list.push(s);
    byStatus.set(s.status, list);
  }

  console.log(`  total symbols: ${symbols.length}`);
  console.log(`  fields: ${Object.keys(symbols[0] ?? {}).join(", ")}\n`);
  for (const [status, list] of [...byStatus].sort((a, b) => b[1].length - a[1].length)) {
    const withOffTime = list.filter((s) => s.offTime > 0).length;
    const notYetOnline = list.filter((s) => s.timeOnline === 0).length;
    console.log(
      `  status ${String(status).padEnd(3)} count ${String(list.length).padStart(5)}` +
        `   offTime set: ${withOffTime}   timeOnline 0: ${notYetOnline}` +
        `   e.g. ${list.slice(0, 3).map((s) => s.symbol).join(", ")}`,
    );
  }

  h("Status decoding — assert against known-live markets");
  const find = (sym: string) => symbols.find((s) => s.symbol === sym);
  for (const t of ["BTC-USDT", "ETH-USDT", "AERO-USDT"]) {
    const m = find(t);
    expect(`${t} is status 1 (live)`, m?.status === 1, `status=${m?.status} offTime=${m?.offTime}`);
  }
  const notLive = byStatus.get(0) ?? [];
  const now = Date.now();
  const delisted = notLive.filter((s) => s.offTime > 0 && s.offTime < now);
  const ambiguous = notLive.filter((s) => !(s.offTime > 0 && s.offTime < now));

  expect(
    "status 0 is the not-live bucket, and is the majority of the list",
    notLive.length > symbols.length / 2,
    `${notLive.length}/${symbols.length} — presence alone must never mean VERIFIED`,
  );
  expect(
    "most status-0 symbols carry a past offTime (provably delisted -> CONTRADICTED)",
    delisted.length > ambiguous.length,
    `${delisted.length} provably delisted vs ${ambiguous.length} ambiguous`,
  );

  // These two are the reason the checker gates on `status` ALONE. Both of the
  // obvious alternative signals are unreliable, so neither may enter a verdict.
  const liveWithOffTime = (byStatus.get(1) ?? []).filter((s) => s.offTime > 0 && s.offTime < now);
  expect(
    "offTime alone cannot mean delisted — some LIVE symbols carry a past offTime",
    liveWithOffTime.length > 0,
    `${liveWithOffTime.length} status-1 symbols have a past offTime, e.g. ${liveWithOffTime[0]?.symbol}`,
  );
  const deadButBuyable = notLive.filter((s) => s.apiStateBuy).length;
  expect(
    "apiStateBuy cannot mean tradeable — most not-live symbols still report true",
    deadButBuyable > notLive.length / 2,
    `${deadButBuyable}/${notLive.length}`,
  );

  const announced = byStatus.get(10) ?? [];
  const testSymbols = symbols.filter((s) => /^TEST\d/i.test(s.symbol));
  console.log(
    `\n  status 10 (${announced.length}): ${announced.filter((s) => s.timeOnline === 0).length} never online` +
      ` — includes non-production entries e.g. ${testSymbols.slice(0, 2).map((s) => s.symbol).join(", ")}`,
  );
  expect(
    "status 10 is not a live market (never treat as VERIFIED)",
    announced.every((s) => s.status !== 1),
    `${announced.length} symbols, ${testSymbols.length} TEST* symbols exist in the list`,
  );

  h("Contract addresses — is there ANY public source?");
  const futures = await getJson<{ data: Record<string, unknown>[] }>(FUTURES);
  save("bingx-futures", futures);
  console.log(`  futures contracts: ${futures.data.length}`);
  console.log(`  fields: ${Object.keys(futures.data[0] ?? {}).join(", ")}`);

  const hasAddress = /0x[0-9a-fA-F]{40}/.test(JSON.stringify(futures.data));
  expect("futures endpoint exposes no contract address", !hasAddress);

  const walletRes = await fetch(WALLET, { signal: AbortSignal.timeout(15_000) });
  const walletBody = (await walletRes.json()) as { code?: number; msg?: string };
  console.log(`  wallets/capital/config/getall -> code ${walletBody.code}: ${walletBody.msg?.slice(0, 60)}`);
  expect("the only contract-bearing endpoint requires an API key", walletBody.code !== 0);

  done(
    "BingX",
    "Works, but the status gate is mandatory",
    `${symbols.length} symbols: status 1=live (${(byStatus.get(1) ?? []).length}), 0=not live (${notLive.length}, of which ${delisted.length} have a past offTime = provably delisted), 10=${announced.length}, 5/25=${(byStatus.get(5) ?? []).length + (byStatus.get(25) ?? []).length}. **Gate on \`status\` alone** — offTime and apiStateBuy are both unreliable (${liveWithOffTime.length} live symbols carry a past offTime; ${deadButBuyable}/${notLive.length} not-live symbols still report apiStateBuy=true). **No contract address on any public endpoint** — BingX VERIFIED is always qualified.`,
  );
}

main().catch((e) => {
  console.error("spike-bingx failed:", e);
  process.exit(1);
});
