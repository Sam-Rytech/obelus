/**
 * spike-exchanges-direct — replace CCXT with direct public REST for the widely-claimed
 * exchanges.
 *
 * WHY: CCXT is unusable on the live path. Measured Sep 22: gate loadMarkets() 46.5s
 * (+10.8s fetchCurrencies), kucoin 4.1s, bitget 5.0s, binance 5.8s — against an 8s
 * per-call ceiling and a 60s pipeline limit (§18). Direct endpoints answer a single
 * symbol in one small request.
 *
 * NETWORK NOTE (Sep 22, Lagos): api.binance.com and www.okx.com do not resolve from
 * the dev machine — DNS failure (curl exit 6) on every documented host, including
 * data-api.binance.vision, api1/api-gcp.binance.com, api.binance.us, aws.okx.com.
 * Bybit is reachable via its alternate domain api.bytick.com. Those two checkers are
 * therefore written from documented shapes and VALIDATED AT RUNTIME: a shape mismatch
 * fails Zod and degrades to UNVERIFIED SOURCE_ERROR (§18 fail-closed), never a wrong
 * verdict. Run this spike from the deployed environment to confirm them.
 *
 * None of these four expose contract addresses publicly (consistent with spike-ccxt:
 * binance/bybit/okx/mexc return no currency networks), so every VERIFIED here carries
 * the "contract unconfirmed" qualifier — same as BingX.
 */
import { save, h, expect, done, UA } from "./_spike.js";

type Probe = {
  id: string;
  /** Single-symbol query — avoids pulling the whole market list per check. */
  url: (ticker: string) => string;
  /** Extract { base, quote, status, live } from the response, or null if absent. */
  read: (body: unknown) => { base: string; quote: string; status: string; live: boolean } | null;
  liveNote: string;
  /** Does the endpoint also return delisted markets? Decides whether absence proves anything. */
  returnsDelisted: boolean | "unknown";
};

const PROBES: Probe[] = [
  {
    id: "binance",
    url: (t) => `https://api.binance.com/api/v3/exchangeInfo?symbol=${t}USDT`,
    read: (b) => {
      const s = (b as { symbols?: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[] })
        ?.symbols?.[0];
      return s ? { base: s.baseAsset, quote: s.quoteAsset, status: s.status, live: s.status === "TRADING" } : null;
    },
    liveNote: 'status === "TRADING"',
    returnsDelisted: "unknown",
  },
  {
    id: "bybit",
    // api.bybit.com is DNS-blocked from Lagos; api.bytick.com is Bybit's documented alternate.
    url: (t) => `https://api.bytick.com/v5/market/instruments-info?category=spot&symbol=${t}USDT`,
    read: (b) => {
      const s = (b as { result?: { list?: { baseCoin: string; quoteCoin: string; status: string }[] } })
        ?.result?.list?.[0];
      return s ? { base: s.baseCoin, quote: s.quoteCoin, status: s.status, live: s.status === "Trading" } : null;
    },
    liveNote: 'status === "Trading"',
    returnsDelisted: "unknown",
  },
  {
    id: "okx",
    url: (t) => `https://www.okx.com/api/v5/public/instruments?instType=SPOT&instId=${t}-USDT`,
    read: (b) => {
      const s = (b as { data?: { baseCcy: string; quoteCcy: string; state: string }[] })?.data?.[0];
      return s ? { base: s.baseCcy, quote: s.quoteCcy, status: s.state, live: s.state === "live" } : null;
    },
    liveNote: 'state === "live"',
    returnsDelisted: "unknown",
  },
  {
    id: "mexc",
    url: (t) => `https://api.mexc.com/api/v3/exchangeInfo?symbol=${t}USDT`,
    read: (b) => {
      const s = (b as {
        symbols?: { symbol: string; status: string; baseAsset: string; quoteAsset: string; isSpotTradingAllowed: boolean }[];
      })?.symbols?.[0];
      return s
        ? {
            base: s.baseAsset,
            quote: s.quoteAsset,
            status: `${s.status} spotAllowed=${s.isSpotTradingAllowed}`,
            live: s.status === "1" && s.isSpotTradingAllowed === true,
          }
        : null;
    },
    // Measured: all 1,950 symbols are status "1" — MEXC omits delisted markets entirely,
    // so absence from this list is genuine evidence of not-listed. 91 are status 1 but
    // not spot-tradeable, which is why isSpotTradingAllowed is part of the gate.
    liveNote: 'status === "1" AND isSpotTradingAllowed',
    returnsDelisted: false,
  },
];

/** BTC must be live everywhere; the nonsense ticker must be absent everywhere. */
const LIVE_TICKER = "BTC";
const ABSENT_TICKER = "ZZZZNOTAREALTOKEN";

async function probe(p: Probe, ticker: string) {
  const res = await fetch(p.url(ticker), {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON: leave null so read() returns null */
  }
  return { status: res.status, bytes: text.length, parsed: p.read(body) };
}

async function main() {
  const results: Record<string, unknown>[] = [];
  const unreachable: string[] = [];

  for (const p of PROBES) {
    h(p.id);
    try {
      // First call pays DNS + TLS handshake (bybit: 9.4s cold vs ~2.3s warm), which
      // would misrepresent the endpoint. Time a warm call, as production will be.
      const cold0 = Date.now();
      await probe(p, LIVE_TICKER);
      const coldMs = Date.now() - cold0;

      const t0 = Date.now();
      const live = await probe(p, LIVE_TICKER);
      const ms = Date.now() - t0;
      const absent = await probe(p, ABSENT_TICKER);
      console.log(`  cold ${coldMs}ms, warm ${ms}ms`);

      console.log(`  ${LIVE_TICKER}USDT  HTTP ${live.status}  ${live.bytes}B  ${ms}ms  -> ${JSON.stringify(live.parsed)}`);
      console.log(`  absent      HTTP ${absent.status}  ${absent.bytes}B  -> ${JSON.stringify(absent.parsed)}`);
      console.log(`  live rule: ${p.liveNote}`);

      expect(`${p.id}: ${LIVE_TICKER} parses to a live market`, live.parsed?.live === true, JSON.stringify(live.parsed));
      expect(`${p.id}: unknown ticker yields no market`, absent.parsed === null);
      expect(`${p.id}: single-symbol response stays small`, live.bytes < 100_000, `${live.bytes}B`);
      expect(`${p.id}: warm call is within the 8s per-call ceiling`, ms < 8_000, `${ms}ms (cold ${coldMs}ms)`);

      results.push({ id: p.id, reachable: true, ms, coldMs, bytes: live.bytes, parsed: live.parsed, liveNote: p.liveNote });
    } catch (e) {
      const msg = String(e);
      const dns = /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg);
      console.log(`  UNREACHABLE${dns ? " (DNS)" : ""}: ${msg.slice(0, 110)}`);
      console.log(`  -> checker still ships; Zod validation degrades a shape mismatch to`);
      console.log(`     UNVERIFIED SOURCE_ERROR rather than a wrong verdict. Re-run on deploy.`);
      unreachable.push(p.id);
      results.push({ id: p.id, reachable: false, error: msg.slice(0, 200) });
    }
  }

  save("exchanges-direct", results);

  h("Summary");
  const ok = results.filter((r) => r.reachable).map((r) => r.id);
  console.log(`  verified here : ${ok.join(", ") || "none"}`);
  console.log(`  unreachable   : ${unreachable.join(", ") || "none"}`);

  done(
    "Exchanges (direct REST)",
    `${ok.length}/${PROBES.length} verified from this machine`,
    `Replaces CCXT on the live path (CCXT measured: gate 46.5s loadMarkets, others 4-6s, vs an 8s ceiling). All four support single-symbol queries. Live rules: binance TRADING, bybit Trading, okx live, mexc status "1" + isSpotTradingAllowed. **MEXC omits delisted markets entirely (all 1,950 are status 1), so absence there is real evidence; the others are unknown in that respect and absence must stay UNVERIFIED.** Verified here: ${ok.join(", ") || "none"}. Unreachable from this network (DNS): ${unreachable.join(", ") || "none"} — bybit needs the alternate host api.bytick.com. None expose contract addresses, so every ✅ is qualified.`,
  );
}

main().catch((e) => {
  console.error("spike-exchanges-direct failed:", e);
  process.exit(1);
});
