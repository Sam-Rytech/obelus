/**
 * Direct-REST listing checkers for Binance, Bybit, OKX and MEXC — architecture §10.1.
 *
 * These replace CCXT on the live path. CCXT is unusable inside the 60 s pipeline
 * budget: measured Sep 22, gate.loadMarkets() alone took 46.5 s (+10.8 s for
 * fetchCurrencies), and kucoin/bitget/binance took 4–6 s each against an 8 s per-call
 * ceiling. Each adapter below answers a SINGLE symbol in one sub-1 KB request.
 *
 * None of these four publishes a contract address publicly (confirmed against CCXT's
 * fetchCurrencies, which returns no currency networks for any of them), so every ✅
 * here is qualified — same position as BingX.
 *
 * REACHABILITY (Sep 22, Lagos): api.binance.com and www.okx.com do not resolve from
 * the dev machine, on any documented host. Bybit needs its alternate domain
 * api.bytick.com. The Binance and OKX adapters are written from documented shapes and
 * validated at runtime: a shape mismatch yields null, which becomes UNVERIFIED
 * SOURCE_ERROR (§18), never a wrong verdict. Re-run scripts/spike-exchanges-direct.ts
 * from the deployment to confirm them.
 */
import { cached, TTL } from "../../lib/cache.js";
import type { Claim, Project } from "../../lib/schema.js";
import { decideListing, type MarketLookup } from "./market.js";
import { evidence, failClosed, type Ctx } from "../types.js";

type Parsed = {
  symbol: string;
  base: string;
  quote: string;
  rawStatus: string;
  state: "live" | "delisted" | "announced" | "unknown";
};

type DirectExchange = {
  id: string;
  label: string;
  url: (ticker: string) => string;
  parse: (body: unknown) => Parsed | null;
  /** True only if the endpoint omits delisted markets entirely (absence is evidence). */
  listIsExhaustive: boolean;
};

export const DIRECT_EXCHANGES: Record<string, DirectExchange> = {
  binance: {
    id: "binance",
    label: "Binance",
    url: (t) => `https://api.binance.com/api/v3/exchangeInfo?symbol=${t}USDT`,
    parse: (body) => {
      const s = (body as { symbols?: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[] })
        ?.symbols?.[0];
      if (!s?.baseAsset) return null;
      return {
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        rawStatus: s.status,
        // BREAK, HALT and AUCTION_MATCH are temporary states, not delistings.
        state: s.status === "TRADING" ? "live" : "unknown",
      };
    },
    listIsExhaustive: false,
  },

  bybit: {
    id: "bybit",
    label: "Bybit",
    // api.bybit.com is DNS-blocked from Lagos; api.bytick.com is Bybit's own alternate.
    url: (t) => `https://api.bytick.com/v5/market/instruments-info?category=spot&symbol=${t}USDT`,
    parse: (body) => {
      const s = (body as { result?: { list?: { symbol: string; baseCoin: string; quoteCoin: string; status: string }[] } })
        ?.result?.list?.[0];
      if (!s?.baseCoin) return null;
      return {
        symbol: s.symbol,
        base: s.baseCoin,
        quote: s.quoteCoin,
        rawStatus: s.status,
        state: s.status === "Trading" ? "live" : "unknown",
      };
    },
    listIsExhaustive: false,
  },

  okx: {
    id: "okx",
    label: "OKX",
    url: (t) => `https://www.okx.com/api/v5/public/instruments?instType=SPOT&instId=${t}-USDT`,
    parse: (body) => {
      const s = (body as { data?: { instId: string; baseCcy: string; quoteCcy: string; state: string }[] })?.data?.[0];
      if (!s?.baseCcy) return null;
      return {
        symbol: s.instId,
        base: s.baseCcy,
        quote: s.quoteCcy,
        rawStatus: s.state,
        // OKX "preopen" is an announced-but-not-trading market.
        state: s.state === "live" ? "live" : s.state === "preopen" ? "announced" : "unknown",
      };
    },
    listIsExhaustive: false,
  },

  mexc: {
    id: "mexc",
    label: "MEXC",
    url: (t) => `https://api.mexc.com/api/v3/exchangeInfo?symbol=${t}USDT`,
    parse: (body) => {
      const s = (body as {
        symbols?: {
          symbol: string;
          status: string;
          baseAsset: string;
          quoteAsset: string;
          isSpotTradingAllowed?: boolean;
        }[];
      })?.symbols?.[0];
      if (!s?.baseAsset) return null;
      return {
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        rawStatus: `${s.status} (spotTradingAllowed=${s.isSpotTradingAllowed})`,
        // Measured: all 1,950 MEXC symbols are status "1", but 91 are not spot-tradeable.
        state: s.status === "1" && s.isSpotTradingAllowed === true ? "live" : "unknown",
      };
    },
    // MEXC returns ONLY live symbols, so absence genuinely means not listed.
    listIsExhaustive: true,
  },
};

/**
 * Distinguish "the exchange answered, and has no such market" from "we could not
 * reach the exchange". Collapsing the two is dangerous: for an exhaustive list like
 * MEXC's, absence means CONTRADICTED, so a DNS blip or timeout would otherwise stamp
 * a false ❌ on a real listing. A source we could not read is evidence of nothing (§3).
 *
 * A 4xx IS an answer on these APIs — several return 400 for an unknown symbol — so it
 * maps to "no market". A 5xx or a transport failure throws and fails closed (§18).
 */
async function fetchMarket(ex: DirectExchange, url: string, ctx: Ctx): Promise<Parsed | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ObelusBot/0.1 (crypto announcement fact-checker)",
      },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (err) {
    // DNS failure, timeout, connection reset — we never heard from the exchange.
    throw new Error(`could not reach ${ex.label}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status >= 500) throw new Error(`${ex.label} returned HTTP ${res.status}`);

  const text = await res.text();
  if (!text.trim()) throw new Error(`${ex.label} returned an empty body (HTTP ${res.status})`);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${ex.label} returned a non-JSON body (HTTP ${res.status})`);
  }

  return ex.parse(body);
}

export function makeDirectChecker(id: keyof typeof DIRECT_EXCHANGES | string) {
  return async function checkDirect(claim: Claim, project: Project, ctx: Ctx) {
    const ex = DIRECT_EXCHANGES[id];
    if (!ex) return failClosed(id, claim, new Error(`No direct adapter for ${id}`));

    try {
      const ticker = project.ticker?.toUpperCase();
      if (!ticker) {
        return failClosed(ex.id, claim, new Error("No ticker was extracted from the announcement"));
      }

      const url = ex.url(ticker);
      const parsed = await cached(`${ex.id}:sym:${ticker}`, TTL.EXCHANGE_SYMBOLS, async () => {
        ctx.budget.spend(`${ex.id}:symbol`);
        return fetchMarket(ex, url, ctx);
      });

      const ev = [
        evidence(
          `${ex.label} public API`,
          url,
          parsed
            ? `${parsed.symbol}: base=${parsed.base}, quote=${parsed.quote}, status=${parsed.rawStatus}`
            : `${ex.label} returned no ${ticker}/USDT spot market`,
        ),
      ];

      const lookup: MarketLookup = {
        exchangeLabel: ex.label,
        endpointUrl: url,
        market: parsed
          ? {
              symbol: parsed.symbol,
              base: parsed.base,
              quote: parsed.quote,
              rawStatus: parsed.rawStatus,
              state: parsed.state,
            }
          : null,
        contractOnBase: null, // none of these four publish one
        listIsExhaustive: ex.listIsExhaustive,
      };

      ctx.trace.step(
        parsed
          ? `${ex.label}: ${parsed.symbol} status ${parsed.rawStatus} (${parsed.state})`
          : `${ex.label}: no ${ticker}/USDT market`,
      );

      return decideListing(claim, lookup, project.contract, ev);
    } catch (err) {
      return failClosed(ex.id, claim, err);
    }
  };
}
