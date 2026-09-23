import { describe, expect, it } from "vitest";

import { formatReport } from "../src/bot/telegram";
import type { Checker } from "../src/checkers/types";
import { StubLlm } from "../src/lib/llm";
import { runPipeline } from "../src/lib/pipeline";
import { parseListingQuestion } from "../src/lib/question";
import { reportHash } from "../src/lib/hash";
import { Report } from "../src/lib/schema";
import { summarizeQuestion } from "../src/lib/summary";

const exchangesOf = (q: string) => parseListingQuestion(q)?.claims.map((c) => c.params.exchange);

describe("parseListingQuestion", () => {
  it("asks every supported exchange when none is named", () => {
    const q = parseListingQuestion("is $BTC listed?");
    expect(q?.ticker).toBe("BTC");
    expect(exchangesOf("is $BTC listed?")).toEqual(["WEEX", "BingX", "MEXC", "Bybit", "Binance", "OKX"]);
    expect(q?.claims.every((c) => c.type === "EXCHANGE_LISTING" && c.quote === "is $BTC listed?")).toBe(true);
  });

  it("asks only the exchanges named", () => {
    expect(exchangesOf("Is $PEPE listed on MEXC?")).toEqual(["MEXC"]);
    expect(exchangesOf("is AERO on WEEX or BingX?")).toEqual(["WEEX", "BingX"]);
    expect(parseListingQuestion("is AERO on WEEX or BingX?")?.ticker).toBe("AERO");
  });

  it("keeps a named exchange Obelus can't check, so the answer says so", () => {
    expect(exchangesOf("is $PEPE listed on KuCoin?")).toEqual(["KuCoin"]);
  });

  it("reads tickers without a $", () => {
    expect(parseListingQuestion("is btc listed?")?.ticker).toBe("BTC");
    expect(parseListingQuestion("Is NOVA trading on Bybit")?.ticker).toBe("NOVA");
  });

  it("is not fooled by exchange names or quote currencies", () => {
    expect(parseListingQuestion("is WIF/USDT listed on OKX?")?.ticker).toBe("WIF");
  });

  it("returns null for anything that isn't a listing question", () => {
    for (const t of [
      "BTC is now listed on WEEX", // a claim, not a question — goes to extraction
      "is it listed?", // no ticker
      "is NOVA audited by CertiK?", // not about listings
      "what is BTC?",
      "https://x.com/i/status/1",
    ]) {
      expect(parseListingQuestion(t), t).toBeNull();
    }
  });
});

const verdict =
  (v: "VERIFIED" | "CONTRADICTED" | "UNVERIFIED", reason: string): Checker =>
  async (claim) => ({ claimId: claim.id, verdict: v, reason, evidence: [] });

describe("pipeline on a listing question", () => {
  it("answers without calling the model and records the mode", async () => {
    const llm = new StubLlm([]);
    const report = await runPipeline("Is $PEPE listed on MEXC?", {
      save: false,
      llm,
      checkers: { EXCHANGE_LISTING: verdict("VERIFIED", "LISTED_CONTRACT_UNCONFIRMED — PEPEUSDT on MEXC") },
    });
    expect(llm.calls).toHaveLength(0);
    expect(report.mode).toBe("question");
    expect(report.project).toEqual({ ticker: "PEPE", chain: "base" });
    expect(report.summary).toContain("PEPE is trading on MEXC.");
    expect(Report.safeParse(report).success).toBe(true);
    expect(reportHash(JSON.parse(JSON.stringify(report)))).toBe(report.reportHash);
  });

  it("leaves announcements unchanged: no mode field", async () => {
    const report = await runPipeline("BTC is now listed on WEEX.", {
      save: false,
      llm: new StubLlm([JSON.stringify({ project: { ticker: "BTC", contract: null }, claims: [] })]),
    });
    expect("mode" in report).toBe(false);
  });
});

describe("question answers", () => {
  const claims = ["WEEX", "MEXC", "Binance", "BingX", "Bybit"].map((exchange, i) => ({
    id: `c${i + 1}`,
    type: "EXCHANGE_LISTING" as const,
    quote: "is $X listed?",
    params: { exchange },
  }));
  const results = [
    { claimId: "c1", verdict: "VERIFIED" as const, reason: "LISTED_CONTRACT_MATCHES — ok", evidence: [] },
    { claimId: "c2", verdict: "CONTRADICTED" as const, reason: "NOT_IN_EXCHANGE_MARKET_LIST — none", evidence: [] },
    { claimId: "c3", verdict: "UNVERIFIED" as const, reason: "SOURCE_ERROR:binance — HTTP 451", evidence: [] },
    { claimId: "c4", verdict: "UNVERIFIED" as const, reason: "FUTURE_CLAIM — announced", evidence: [] },
    { claimId: "c5", verdict: "UNVERIFIED" as const, reason: "NOT_IN_EXCHANGE_MARKET_LIST — not found", evidence: [] },
  ];

  it("groups each exchange under what its own API said", () => {
    const s = summarizeQuestion("X", claims, results);
    expect(s).toContain("X is trading on WEEX.");
    expect(s).toContain("Not trading on MEXC");
    expect(s).toContain("Announced but not trading yet on BingX.");
    expect(s).toContain("No X/USDT spot market found on Bybit.");
    expect(s).toContain("Couldn't get an answer from Binance");
    expect(s).toContain("can't confirm which token");
  });

  it("Telegram labels each answer by exchange and shows them all", () => {
    const report = {
      id: "q1",
      mode: "question",
      input: { kind: "text", value: "is $X listed?", fetchedText: "is $X listed?" },
      project: { ticker: "X", chain: "base" },
      claims,
      results,
      summary: "",
      trace: [],
      engineVersion: "t",
      createdAt: new Date().toISOString(),
      reportHash: "0x",
    } as Report;
    const text = formatReport(report, "https://o.example");
    expect(text).toContain("<b>Is X listed?</b>");
    for (const ex of ["WEEX", "MEXC", "Binance", "BingX", "Bybit"]) expect(text).toContain(`Listed on ${ex}?`);
    expect(text).not.toContain("more.");
  });
});
