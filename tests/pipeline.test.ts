/**
 * Pipeline + resolution — architecture §5. Runs the real pipeline with a stub model
 * and stub checkers, so it is fast and offline while still exercising orchestration:
 * guards, parallel checks, timeouts, fail-closed, summary and hashing.
 */
import { describe, expect, it } from "vitest";

import type { Checker } from "../src/checkers/types";
import { reportHash } from "../src/lib/hash";
import { StubLlm } from "../src/lib/llm";
import { PipelineError, runPipeline } from "../src/lib/pipeline";
import { chooseToken } from "../src/lib/resolve";
import { Report } from "../src/lib/schema";
import { summarize } from "../src/lib/summary";

const TEXT = "NovaBase (NOVA) is now listed on WEEX. Ownership has been renounced. We partner with Chainlink.";

const modelSays = (claims: unknown[]) =>
  new StubLlm([JSON.stringify({ project: { name: "NovaBase", ticker: "NOVA", contract: null }, claims })]);

const verdict = (v: "VERIFIED" | "CONTRADICTED" | "UNVERIFIED"): Checker => async (claim) => ({
  claimId: claim.id,
  verdict: v,
  reason: `STUB — ${v.toLowerCase()}`,
  evidence: [],
});

const claims = [
  { id: "x", type: "EXCHANGE_LISTING", quote: "NOVA is now listed on WEEX", params: { exchange: "WEEX" } },
  { id: "y", type: "OWNERSHIP_RENOUNCED", quote: "Ownership has been renounced", params: {} },
  { id: "z", type: "PARTNERSHIP", quote: "We partner with Chainlink", params: { partner: "Chainlink" } },
];

// Resolution would hit DexScreener for these claim types; there is no contract in the
// text and the stub returns none, so give the resolver a checker set that doesn't need it.
const offline = { save: false as const, search: { search: async () => [] } };

describe("runPipeline", () => {
  it("produces a schema-valid, correctly hashed report", async () => {
    const report = await runPipeline(TEXT, {
      ...offline,
      llm: modelSays([claims[2]]),
      checkers: { PARTNERSHIP: verdict("VERIFIED") },
    });

    expect(Report.safeParse(report).success).toBe(true);
    expect(report.reportHash).toBe(reportHash(report));
    // And from the stored-JSON shape, as the verify page will see it.
    expect(reportHash(JSON.parse(JSON.stringify(report)))).toBe(report.reportHash);
  });

  it("gives every claim a result, in claim order", async () => {
    const report = await runPipeline(TEXT, {
      ...offline,
      llm: modelSays([claims[2], { ...claims[2], id: "w", quote: "NovaBase (NOVA)", type: "OTHER", params: {} }]),
      checkers: { PARTNERSHIP: verdict("VERIFIED") },
    });
    expect(report.results.map((r) => r.claimId)).toEqual(report.claims.map((c) => c.id));
  });

  it("drops a hallucinated claim before any checker sees it", async () => {
    let checked = 0;
    const report = await runPipeline(TEXT, {
      ...offline,
      llm: modelSays([{ id: "q", type: "PARTNERSHIP", quote: "We partner with OpenAI", params: { partner: "OpenAI" } }]),
      checkers: {
        PARTNERSHIP: async (c) => {
          checked++;
          return verdict("VERIFIED")(c, { chain: "base" }, {} as never);
        },
      },
    });
    expect(report.claims).toHaveLength(0);
    expect(checked).toBe(0);
    expect(report.trace.some((t) => t.step.includes("QUOTE_NOT_IN_SOURCE"))).toBe(true);
  });

  it("turns a checker that throws into UNVERIFIED instead of failing the report", async () => {
    const report = await runPipeline(TEXT, {
      ...offline,
      llm: modelSays([claims[2]]),
      checkers: {
        PARTNERSHIP: async () => {
          throw new Error("bug in checker");
        },
      },
    });
    expect(report.results[0]?.verdict).toBe("UNVERIFIED");
    expect(report.results[0]?.reason).toContain("SOURCE_ERROR");
  });

  it("turns a checker that hangs into UNVERIFIED after the per-claim timeout", async () => {
    const report = await runPipeline(TEXT, {
      ...offline,
      claimTimeoutMs: 50,
      llm: modelSays([claims[2]]),
      checkers: { PARTNERSHIP: () => new Promise(() => {}) },
    });
    expect(report.results[0]?.verdict).toBe("UNVERIFIED");
    expect(report.results[0]?.reason).toContain("timeout");
  });

  it("maps an extraction failure to a PipelineError, not a crash", async () => {
    await expect(runPipeline(TEXT, { ...offline, llm: new StubLlm(["not json at all"]) })).rejects.toBeInstanceOf(
      PipelineError,
    );
  });

  it("maps bad input to an INGEST error", async () => {
    await expect(runPipeline("   ", { ...offline, llm: modelSays([]) })).rejects.toMatchObject({
      code: expect.stringMatching(/^INGEST_/),
    });
  });
});

describe("summarize", () => {
  it("leads with contradictions and states what UNVERIFIED means", () => {
    const s = summarize(
      { chain: "base", name: "NovaBase", ticker: "NOVA" },
      [claims[0], claims[1]] as never,
      [
        { claimId: "x", verdict: "CONTRADICTED", reason: "MARKET_DELISTED — NOVA-USDT is delisted", evidence: [] },
        { claimId: "y", verdict: "UNVERIFIED", reason: "NO_OWNER_FUNCTION — none", evidence: [] },
      ],
    );
    expect(s).toContain("NovaBase (NOVA): 0 verified, 1 contradicted, 1 unverified");
    expect(s).toContain("NOVA-USDT is delisted");
    expect(s).toContain("not that it is false");
  });

  it("never states a verdict count that differs from the results", () => {
    const results = [
      { claimId: "x", verdict: "VERIFIED" as const, reason: "R — r", evidence: [] },
      { claimId: "y", verdict: "VERIFIED" as const, reason: "R — r", evidence: [] },
    ];
    expect(summarize({ chain: "base" }, [claims[0], claims[1]] as never, results)).toContain("2 verified, 0 contradicted, 0 unverified");
  });
});

describe("chooseToken (contract resolution)", () => {
  const pair = (address: string, name: string, symbol = "NOVA", usd = 100) => ({
    chainId: "base",
    baseToken: { address, name, symbol },
    liquidity: { usd },
  });

  it("resolves when exactly one Base token has the ticker", () => {
    const r = chooseToken([pair("0xAAA", "NovaBase"), pair("0xAAA", "NovaBase")], "NOVA", "NovaBase");
    expect(r.chosen?.address).toBe("0xaaa");
  });

  it("disambiguates clones by project name", () => {
    const r = chooseToken([pair("0xAAA", "NovaBase"), pair("0xBBB", "Nova Clone", "NOVA", 9e9)], "NOVA", "NovaBase");
    expect(r.chosen?.address).toBe("0xaaa");
  });

  it("refuses to guess between clones, even a far richer one", () => {
    // "Highest liquidity wins" is exactly how a well-funded clone would get picked.
    const r = chooseToken([pair("0xAAA", "Nova A"), pair("0xBBB", "Nova B", "NOVA", 9e9)], "NOVA", "NovaBase");
    expect(r.chosen).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });

  it("ignores other chains and other tickers", () => {
    const r = chooseToken(
      [{ ...pair("0xAAA", "NovaBase"), chainId: "ethereum" }, pair("0xBBB", "NovaBase", "NOVAX")],
      "NOVA",
      "NovaBase",
    );
    expect(r.chosen).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });
});
