/**
 * Direct-REST adapters — architecture §10.1.
 *
 * The critical property here is that an UNREACHABLE source is never mistaken for an
 * ANSWER. MEXC's list is exhaustive, so "no market" means CONTRADICTED — which means a
 * DNS blip or a timeout must not be allowed to look like "no market", or a transient
 * network fault would stamp a false ❌ on a genuine listing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIRECT_EXCHANGES, makeDirectChecker } from "../src/checkers/exchange/direct.js";
import type { Ctx } from "../src/checkers/types.js";
import { Budget } from "../src/lib/budget.js";
import { resetCacheForTests } from "../src/lib/cache.js";
import type { Claim, Project } from "../src/lib/schema.js";
import { Trace } from "../src/lib/trace.js";

const claim: Claim = {
  id: "c1",
  type: "EXCHANGE_LISTING",
  quote: "listed on MEXC",
  params: { exchange: "MEXC" },
};
const project: Project = { chain: "base", ticker: "AERO" };

function ctx(): Ctx {
  return { budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000 };
}

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => resetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("parsers match the shapes measured on Sep 22", () => {
  it("parses a live MEXC market, requiring isSpotTradingAllowed", () => {
    const parse = DIRECT_EXCHANGES.mexc!.parse;
    expect(
      parse({ symbols: [{ symbol: "AEROUSDT", status: "1", baseAsset: "AERO", quoteAsset: "USDT", isSpotTradingAllowed: true }] }),
    ).toMatchObject({ base: "AERO", state: "live" });

    // 91 of MEXC's 1,950 symbols are status "1" yet not spot-tradeable.
    expect(
      parse({ symbols: [{ symbol: "AEROUSDT", status: "1", baseAsset: "AERO", quoteAsset: "USDT", isSpotTradingAllowed: false }] }),
    ).toMatchObject({ state: "unknown" });
  });

  it("parses a live Bybit market", () => {
    expect(
      DIRECT_EXCHANGES.bybit!.parse({
        result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" }] },
      }),
    ).toMatchObject({ base: "BTC", state: "live" });
  });

  it("treats OKX preopen as announced, not live", () => {
    expect(
      DIRECT_EXCHANGES.okx!.parse({ data: [{ instId: "X-USDT", baseCcy: "X", quoteCcy: "USDT", state: "preopen" }] }),
    ).toMatchObject({ state: "announced" });
  });

  it("returns null when the response contains no market", () => {
    for (const ex of Object.values(DIRECT_EXCHANGES)) {
      expect(ex.parse({})).toBeNull();
    }
  });

  it("only marks MEXC's list as exhaustive", () => {
    // MEXC omits delisted symbols; the others retain or may retain them.
    expect(DIRECT_EXCHANGES.mexc!.listIsExhaustive).toBe(true);
    for (const id of ["binance", "bybit", "okx"]) {
      expect(DIRECT_EXCHANGES[id]!.listIsExhaustive).toBe(false);
    }
  });
});

describe("an unreachable source is never treated as an answer", () => {
  it("returns UNVERIFIED SOURCE_ERROR when DNS fails", async () => {
    // api.binance.com and www.okx.com genuinely do not resolve from the dev network,
    // so this is the observed failure mode, not a hypothetical one.
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());

    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
    // The dangerous wrong answer would have been CONTRADICTED.
    expect(r.verdict).not.toBe("CONTRADICTED");
  });

  it("returns UNVERIFIED when the request times out", async () => {
    mockFetch(() => Promise.reject(new DOMException("The operation was aborted", "TimeoutError")));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });

  it("returns UNVERIFIED on a 5xx", async () => {
    mockFetch(() => new Response("upstream exploded", { status: 503 }));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });

  it("returns UNVERIFIED on an empty body", async () => {
    // Observed live: BingX served 0 bytes after ~12s during this session.
    mockFetch(() => new Response("", { status: 200 }));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });

  it("returns UNVERIFIED on a non-JSON body", async () => {
    // A captive portal or WAF interstitial returns HTML with HTTP 200.
    mockFetch(() => new Response("<html>Access denied</html>", { status: 200 }));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });
});

describe("a real answer is acted on", () => {
  it("CONTRADICTED when MEXC answers with no such market", async () => {
    // MEXC's list is exhaustive, so this absence is genuine evidence.
    mockFetch(() => json({ symbols: [] }));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("NOT_IN_EXCHANGE_MARKET_LIST");
  });

  it("treats a 4xx as a genuine 'no such market', because these APIs answer that way", async () => {
    mockFetch(() => json({ code: -1121, msg: "Invalid symbol." }, 400));
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("CONTRADICTED");
  });

  it("VERIFIED but qualified for a live market, since none of these publish contracts", async () => {
    mockFetch(() =>
      json({ symbols: [{ symbol: "AEROUSDT", status: "1", baseAsset: "AERO", quoteAsset: "USDT", isSpotTradingAllowed: true }] }),
    );
    const r = await makeDirectChecker("mexc")(claim, project, ctx());
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBe("Ticker listed — contract unconfirmed");
  });

  it("UNVERIFIED when the announcement carried no ticker to look up", async () => {
    mockFetch(() => json({ symbols: [] }));
    const r = await makeDirectChecker("mexc")(claim, { chain: "base" }, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
  });
});
