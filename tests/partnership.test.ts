/**
 * PARTNERSHIP — architecture §10.5, rule decided with Sam on Sep 23: the project name
 * AND partnership language must appear in the same sentence on the partner's own
 * domain. A mention alone is MENTION_ONLY. Never CONTRADICTED.
 */
import { describe, expect, it } from "vitest";

import { checkPartnership, classifyPage, PARTNERSHIP_LANGUAGE } from "../src/checkers/partnership";
import type { Ctx } from "../src/checkers/types";
import { Budget } from "../src/lib/budget";
import type { Claim, Project } from "../src/lib/schema";
import type { SearchResult, Searcher } from "../src/lib/search";
import { Trace } from "../src/lib/trace";

const claim: Claim = { id: "c1", type: "PARTNERSHIP", quote: "partnership with Chainlink", params: { partner: "Chainlink" } };
const project: Project = { chain: "base", name: "Aave" };

function ctx(results: SearchResult[]): Ctx {
  const search: Searcher = { search: async () => results };
  return { budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000, search };
}

describe("classifyPage", () => {
  it("treats a price-feed page as a mention, not a partnership", () => {
    // Shaped like the real data.chain.link hits from the Sep 23 spike.
    const page = "AAVE / USD. Aave price feed on Ethereum Mainnet. Deviation threshold 1%.";
    expect(classifyPage(page, "Aave").kind).toBe("mention");
  });

  it("requires name and partnership language in the SAME sentence", () => {
    // A docs page can mention the token in one place and "integrate" in another.
    const page = "AAVE / USD feed. Learn how to integrate Data Feeds into your contracts.";
    expect(classifyPage(page, "Aave").kind).toBe("mention");
  });

  it("confirms a sentence that names the project in partnership terms", () => {
    const r = classifyPage("Today Aave integrates Chainlink CCIP for cross-chain governance.", "Aave");
    expect(r).toEqual({ kind: "partnership", sentence: "Today Aave integrates Chainlink CCIP for cross-chain governance." });
  });

  it("matches the name as a whole word only", () => {
    // "Nova" must not match "Supernova", or short names verify against anything.
    expect(classifyPage("Supernova partners with Chainlink.", "Nova").kind).toBe("absent");
  });

  it("is absent when the page never names the project", () => {
    expect(classifyPage("Chainlink partners with many protocols.", "Aave").kind).toBe("absent");
  });

  it("recognises each partnership phrase on the agreed list", () => {
    for (const s of ["partner", "partners", "partnered", "partnership", "collaboration", "collaborating", "integrates", "integration", "joins forces", "joined forces"]) {
      expect(PARTNERSHIP_LANGUAGE.test(`Aave ${s} with Chainlink`), s).toBe(true);
    }
    expect(PARTNERSHIP_LANGUAGE.test("Aave price feed")).toBe(false);
  });
});

describe("checkPartnership", () => {
  it("VERIFIED with the sentence as evidence", async () => {
    const r = await checkPartnership(
      claim,
      project,
      ctx([{ url: "https://blog.chain.link/aave-ccip/", title: "Aave x Chainlink", content: "Aave integrates Chainlink CCIP." }]),
    );
    expect(r.verdict).toBe("VERIFIED");
    expect(r.evidence[0]?.excerpt).toContain("Aave integrates Chainlink CCIP");
  });

  it("UNVERIFIED MENTION_ONLY for a price feed, with the page still linked", async () => {
    const r = await checkPartnership(
      claim,
      project,
      ctx([{ url: "https://data.chain.link/feeds/ethereum/mainnet/aave-usd", title: "AAVE / USD", content: "Aave price feed." }]),
    );
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("MENTION_ONLY");
    expect(r.evidence[0]?.url).toContain("data.chain.link");
  });

  it("ignores Tavily's unrelated results for a project it can't find", async () => {
    // Observed Sep 23: 5 results for a fabricated project, none mentioning it.
    const noise = Array.from({ length: 5 }, (_, i) => ({
      url: `https://chain.link/page-${i}`,
      title: "Chainlink",
      content: "Chainlink partners with leading protocols.",
    }));
    const r = await checkPartnership(claim, { chain: "base", name: "Zyxqvort Protocol" }, ctx(noise));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("NO_PARTNER_CONFIRMATION");
  });

  it("ignores a result off the partner's domain, even with perfect wording", async () => {
    const r = await checkPartnership(
      claim,
      project,
      ctx([{ url: "https://cryptonews.example/aave", title: "", content: "Aave announces partnership with Chainlink." }]),
    );
    expect(r.verdict).toBe("UNVERIFIED");
  });

  it("is never CONTRADICTED", async () => {
    for (const results of [[], [{ url: "https://chain.link/x", title: "", content: "nothing relevant" }]]) {
      const r = await checkPartnership(claim, project, ctx(results));
      expect(r.verdict).not.toBe("CONTRADICTED");
    }
  });

  it("UNVERIFIED for a partner outside the registry", async () => {
    const r = await checkPartnership({ ...claim, params: { partner: "Some Big Bank" } }, project, ctx([]));
    expect(r.reason).toContain("PARTNER_NOT_IN_REGISTRY");
  });
});
