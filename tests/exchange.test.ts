/**
 * Listing verdict rules — architecture §10.1.
 *
 * `decideListing` is pure, so every branch is tested without a network. These are the
 * rules where a mistake puts a wrong stamp on a real project, so each case states the
 * measurement or principle behind it.
 */
import { describe, expect, it } from "vitest";

import { decideListing, type MarketLookup } from "../src/checkers/exchange/market.js";
import type { Claim } from "../src/lib/schema.js";

const claim: Claim = {
  id: "c1",
  type: "EXCHANGE_LISTING",
  quote: "now listed on WEEX",
  params: { exchange: "WEEX" },
};

const AERO = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
const OTHER = "0x1111111111111111111111111111111111111111";

function lookup(over: Partial<MarketLookup> = {}): MarketLookup {
  return {
    exchangeLabel: "WEEX",
    endpointUrl: "https://api-spot.weex.com/api/v3/exchangeInfo",
    market: { symbol: "AEROUSDT", base: "AERO", quote: "USDT", rawStatus: "TRADING", state: "live" },
    contractOnBase: null,
    listIsExhaustive: false,
    ...over,
  };
}

describe("live market, contract identity", () => {
  it("VERIFIED unqualified when the listed contract matches the announcement", () => {
    const r = decideListing(claim, lookup({ contractOnBase: AERO }), AERO);
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBeUndefined();
  });

  it("matches contracts case-insensitively", () => {
    const r = decideListing(claim, lookup({ contractOnBase: AERO }), AERO.toUpperCase());
    expect(r.verdict).toBe("VERIFIED");
  });

  it("CONTRADICTED when the exchange lists a different token under the same ticker", () => {
    // The flagship scam case (§20). Only reachable where the exchange publishes an
    // address — in v1 that means WEEX.
    const r = decideListing(claim, lookup({ contractOnBase: OTHER }), AERO);
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("DIFFERENT_TOKEN_SAME_TICKER");
  });

  it("VERIFIED but qualified when the exchange publishes no contract", () => {
    // BingX and every direct-REST exchange land here: never a plain ✅ (§20).
    const r = decideListing(claim, lookup({ exchangeLabel: "BingX", contractOnBase: null }), AERO);
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBe("Ticker listed — contract unconfirmed");
  });

  it("VERIFIED but qualified when the announcement stated no contract", () => {
    const r = decideListing(claim, lookup({ contractOnBase: AERO }), undefined);
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBe("Ticker listed — contract unconfirmed");
  });
});

describe("status gate", () => {
  it("CONTRADICTED for a provably delisted market", () => {
    const r = decideListing(
      claim,
      lookup({
        market: { symbol: "AIS-USDT", base: "AIS", quote: "USDT", rawStatus: "0", state: "delisted", detail: "offTime 2025-09-11" },
      }),
      undefined,
    );
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("MARKET_DELISTED");
    expect(r.qualifier).toContain("2025-09-11");
  });

  it("UNVERIFIED for a market that is listed but not yet trading", () => {
    // BingX status 10 / OKX preopen. The exchange's own data says "not yet".
    const r = decideListing(
      claim,
      lookup({ market: { symbol: "EPS-USDT", base: "EPS", quote: "USDT", rawStatus: "10", state: "announced" } }),
      undefined,
    );
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("FUTURE_CLAIM");
  });

  it("UNVERIFIED for an uninterpretable status, rather than guessing", () => {
    // BingX statuses 5 and 25 are undocumented; WEEX HALT could be suspension or
    // delisting. §18 says fail closed.
    const r = decideListing(
      claim,
      lookup({ market: { symbol: "AT-USDT", base: "AT", quote: "USDT", rawStatus: "25", state: "unknown" } }),
      undefined,
    );
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("UNKNOWN_MARKET_STATUS");
  });

  it("never returns VERIFIED for a non-live market, whatever the contract says", () => {
    // Regression guard for the original §10.1 bug: presence in the symbol list was
    // enough to verify, which would have stamped ✅ on 1,581 dead BingX markets.
    for (const state of ["delisted", "announced", "unknown"] as const) {
      const r = decideListing(
        claim,
        lookup({
          contractOnBase: AERO,
          market: { symbol: "X-USDT", base: "X", quote: "USDT", rawStatus: "?", state },
        }),
        AERO,
      );
      expect(r.verdict).not.toBe("VERIFIED");
    }
  });
});

describe("absence of a market", () => {
  it("CONTRADICTED only when the exchange's list is exhaustive", () => {
    // MEXC omits delisted markets entirely (all 1,950 symbols are status "1"), so
    // absence there really does disprove the claim.
    const r = decideListing(
      claim,
      lookup({ exchangeLabel: "MEXC", market: null, listIsExhaustive: true }),
      undefined,
    );
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("NOT_IN_EXCHANGE_MARKET_LIST");
  });

  it("UNVERIFIED when the list may retain delisted entries", () => {
    // §3: absence of proof is never disproof. BingX and WEEX both keep non-live
    // symbols, so "not found" cannot mean "never listed".
    const r = decideListing(claim, lookup({ market: null, listIsExhaustive: false }), undefined);
    expect(r.verdict).toBe("UNVERIFIED");
  });
});

describe("evidence", () => {
  it("carries the evidence it was given through to the result", () => {
    const ev = [
      {
        source: "WEEX public API",
        url: "https://api-spot.weex.com/api/v3/exchangeInfo",
        fetchedAt: new Date().toISOString(),
        excerpt: "AEROUSDT: status=TRADING",
      },
    ];
    const r = decideListing(claim, lookup(), undefined, ev);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]?.url).toContain("weex.com");
  });

  it("quotes the raw status value in the reason, so a verdict is auditable", () => {
    const r = decideListing(claim, lookup(), undefined);
    expect(r.reason).toContain("TRADING");
  });
});
