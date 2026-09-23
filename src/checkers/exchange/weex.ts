/**
 * WEEX listing checker — architecture §10.1.
 *
 * WEEX is the PRIMARY listing checker because it is the only public exchange API that
 * publishes contract addresses, which makes it the only one that can reach an
 * unqualified VERIFIED or detect DIFFERENT_TOKEN_SAME_TICKER (verified Sep 22).
 *
 * Endpoints (both public, no key):
 *   v3/exchangeInfo — 3,508 symbols with baseAsset/quoteAsset/status TRADING|HALT.
 *   v3/coins        — networkList[] with contractAddress; 467 of 3,971 coins carry
 *                     one, 42 of those on BASE.
 *
 * Do NOT use v2/public/products: it returns bare strings ("MRVLONUSDT_SPBL") with no
 * base/quote separator, so ticker matching is undecidable.
 */
import { cached, TTL } from "../../lib/cache";
import type { Claim, Project } from "../../lib/schema";
import { decideListing, type MarketLookup } from "./market";
import { evidence, failClosed, getJson, type Ctx } from "../types";

const EXCHANGE_INFO = "https://api-spot.weex.com/api/v3/exchangeInfo";
const COINS = "https://api-spot.weex.com/api/v3/coins";

type WeexMarket = { symbol: string; baseAsset: string; quoteAsset: string; status: string };
type WeexNetwork = { network: string; contractAddress?: string; contractAddressUrl?: string };
type WeexCoin = { coin: string; name: string; networkList: WeexNetwork[] };

/** WEEX gives an explicit status; anything we don't recognise fails closed. */
function toState(status: string): "live" | "delisted" | "unknown" {
  if (status === "TRADING") return "live";
  // HALT covers suspended and delisted alike. We cannot tell which, so we must not
  // claim "delisted" — that would be asserting more than the source supports.
  if (status === "HALT") return "unknown";
  return "unknown";
}

async function loadMarkets(ctx: Ctx): Promise<WeexMarket[]> {
  return cached("weex:markets:v2", TTL.EXCHANGE_SYMBOLS, async () => {
    ctx.budget.spend("weex:exchangeInfo");
    const body = await getJson<{ symbols: WeexMarket[] }>(EXCHANGE_INFO, ctx);
    // Keep only the four fields used. The full response is ~1.7 MB, over Upstash's
    // 1 MB value cap: caching it raw failed silently and slowly on every request, so
    // WEEX was never actually cached (found in the first live run, Sep 23).
    return (body.symbols ?? []).map(({ symbol, baseAsset, quoteAsset, status }) => ({
      symbol,
      baseAsset,
      quoteAsset,
      status,
    }));
  });
}

async function loadBaseContracts(ctx: Ctx): Promise<Record<string, string>> {
  return cached("weex:base-contracts", TTL.EXCHANGE_SYMBOLS, async () => {
    ctx.budget.spend("weex:coins");
    const coins = await getJson<WeexCoin[]>(COINS, ctx);
    const map: Record<string, string> = {};
    for (const coin of coins ?? []) {
      // Only a BASE-network address may be compared: matching a Base token against an
      // address on another chain would manufacture a false DIFFERENT_TOKEN_SAME_TICKER.
      const base = coin.networkList?.find(
        (n) => /^base(evm|chain|mainnet)?$/i.test(n.network?.trim() ?? "") && n.contractAddress,
      );
      if (base?.contractAddress) map[coin.coin.toUpperCase()] = base.contractAddress.toLowerCase();
    }
    return map;
  });
}

export async function checkWeex(claim: Claim, project: Project, ctx: Ctx) {
  try {
    const ticker = project.ticker?.toUpperCase();
    if (!ticker) {
      return failClosed("weex", claim, new Error("No ticker was extracted from the announcement"));
    }

    // Fetch both lists at once: sequentially they took >20 s cold from Lagos. The
    // contract map is small once reduced, so fetching it speculatively is cheap.
    const [markets, contracts] = await Promise.all([loadMarkets(ctx), loadBaseContracts(ctx)]);
    const matches = markets.filter((m) => m.baseAsset?.toUpperCase() === ticker);
    // Prefer a live market: a token can have both a TRADING and a HALT pair.
    const market = matches.find((m) => m.status === "TRADING") ?? matches[0];

    const ev = [
      evidence(
        "WEEX public API",
        EXCHANGE_INFO,
        market
          ? `${market.symbol}: baseAsset=${market.baseAsset}, quoteAsset=${market.quoteAsset}, status=${market.status}`
          : `No market with baseAsset=${ticker} among ${markets.length} WEEX spot symbols`,
      ),
    ];

    let contractOnBase: string | null = null;
    if (market) {
      contractOnBase = contracts[ticker] ?? null;
      if (contractOnBase) {
        ev.push(
          evidence("WEEX public API", COINS, `${ticker} on network BASE: contractAddress=${contractOnBase}`),
        );
      }
    }

    const lookup: MarketLookup = {
      exchangeLabel: "WEEX",
      endpointUrl: EXCHANGE_INFO,
      market: market
        ? {
            symbol: market.symbol,
            base: market.baseAsset,
            quote: market.quoteAsset,
            rawStatus: market.status,
            state: toState(market.status),
            detail: market.status === "HALT" ? "market is halted on WEEX" : undefined,
          }
        : null,
      contractOnBase,
      // WEEX returns 1,054 HALT symbols alongside 2,454 TRADING ones, so its list
      // retains non-live markets and absence from it does not prove never-listed.
      listIsExhaustive: false,
    };

    ctx.trace.step(
      market
        ? `WEEX: ${market.symbol} status ${market.status}${contractOnBase ? ` (contract ${contractOnBase.slice(0, 10)}…)` : " (no contract published)"}`
        : `WEEX: no market for ${ticker}`,
    );

    return decideListing(claim, lookup, project.contract, ev, project.contractSource);
  } catch (err) {
    return failClosed("weex", claim, err);
  }
}
