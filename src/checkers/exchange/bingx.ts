/**
 * BingX listing checker — architecture §10.1.
 *
 * BingX can NEVER reach an unqualified VERIFIED: no public endpoint publishes a
 * contract address (spot symbols, futures contracts — neither; the one that would,
 * /wallets/v1/capital/config/getall, requires an API key). Every ✅ here is qualified
 * "Ticker listed — contract unconfirmed", and the report says so plainly.
 *
 * The status gate is the point of this checker. Measured Sep 22 across all 2,271
 * symbols: 643 live (status 1), 1,581 not live (status 0), 41 announced (status 10),
 * 6 other (5/25), plus 31 TEST* symbols. Verifying on presence alone would stamp ✅
 * on 1,581 dead markets.
 *
 * Gate on `status` ALONE. Both plausible alternatives are provably unreliable:
 *   - 18 live symbols carry a PAST offTime.
 *   - 1,302 of the 1,581 not-live symbols still report apiStateBuy: true.
 */
import { cached, TTL } from "../../lib/cache";
import type { Claim, Project } from "../../lib/schema";
import { decideListing, type MarketLookup } from "./market";
import { evidence, failClosed, getJson, type Ctx } from "../types";

const SYMBOLS = "https://open-api.bingx.com/openApi/spot/v1/common/symbols";

type BingxSymbol = {
  symbol: string;
  status: number;
  offTime: number;
  timeOnline: number;
  apiStateBuy: boolean;
};

function toState(s: BingxSymbol): { state: "live" | "delisted" | "announced" | "unknown"; detail?: string } {
  if (s.status === 1) return { state: "live" };

  if (s.status === 0) {
    // Only a PAST offTime proves it was listed and then removed. Without one we can
    // show it is not trading but not that it ever was — that stays UNVERIFIED (§3).
    if (s.offTime > 0 && s.offTime < Date.now()) {
      return { state: "delisted", detail: `offTime ${new Date(s.offTime).toISOString().slice(0, 10)}` };
    }
    return { state: "unknown", detail: "status 0 (not live) with no recorded delisting date" };
  }

  // 10 = listed but not yet trading. 5/25 are rare and undocumented — fail closed.
  if (s.status === 10) return { state: "announced", detail: "status 10, not yet trading" };
  return { state: "unknown", detail: `undocumented status ${s.status}` };
}

async function loadSymbols(ctx: Ctx): Promise<BingxSymbol[]> {
  return cached("bingx:symbols:v2", TTL.EXCHANGE_SYMBOLS, async () => {
    ctx.budget.spend("bingx:symbols");
    const body = await getJson<{ data: { symbols: BingxSymbol[] } }>(SYMBOLS, ctx);
    // Only the fields the status gate reads — the raw 670 KB list is near Upstash's
    // 1 MB value cap and slow to push from far regions.
    return (body.data?.symbols ?? []).map(({ symbol, status, offTime, timeOnline, apiStateBuy }) => ({
      symbol,
      status,
      offTime,
      timeOnline,
      apiStateBuy,
    }));
  });
}

export async function checkBingx(claim: Claim, project: Project, ctx: Ctx) {
  try {
    const ticker = project.ticker?.toUpperCase();
    if (!ticker) {
      return failClosed("bingx", claim, new Error("No ticker was extracted from the announcement"));
    }

    const symbols = await loadSymbols(ctx);
    // BingX spot symbols are "BASE-USDT": the hyphen makes the base unambiguous.
    const matches = symbols.filter((s) => s.symbol?.split("-")[0]?.toUpperCase() === ticker);
    const market = matches.find((s) => s.status === 1) ?? matches[0];
    const state = market ? toState(market) : null;

    const ev = [
      evidence(
        "BingX public API",
        SYMBOLS,
        market
          ? `${market.symbol}: status=${market.status}, offTime=${market.offTime}, timeOnline=${market.timeOnline}`
          : `No market with base ${ticker} among ${symbols.length} BingX spot symbols`,
      ),
    ];

    const lookup: MarketLookup = {
      exchangeLabel: "BingX",
      endpointUrl: SYMBOLS,
      market:
        market && state
          ? {
              symbol: market.symbol,
              base: ticker,
              quote: market.symbol.split("-")[1] ?? "",
              rawStatus: String(market.status),
              state: state.state,
              detail: state.detail,
            }
          : null,
      // BingX keeps delisted symbols in the list, so absence proves nothing.
      contractOnBase: null,
      listIsExhaustive: false,
    };

    ctx.trace.step(
      market ? `BingX: ${market.symbol} status ${market.status} (${state?.state})` : `BingX: no market for ${ticker}`,
    );

    return decideListing(claim, lookup, project.contract, ev, project.contractSource);
  } catch (err) {
    return failClosed("bingx", claim, err);
  }
}
