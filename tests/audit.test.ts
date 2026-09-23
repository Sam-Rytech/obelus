/**
 * AUDIT — architecture §10.2. The CertiK page reader is tested against the exact page
 * shapes observed on Sep 22–23, including the trap: "Code Audit History" appears on
 * unaudited pages too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIT_SCOPE_QUALIFIER,
  certikSlug,
  checkAudit,
  classifyAuditPage,
  pickCertikSlug,
  readCertikPage,
} from "../src/checkers/audit";
import type { Ctx } from "../src/checkers/types";
import { Budget } from "../src/lib/budget";
import { resetCacheForTests } from "../src/lib/cache";
import type { Claim, Project } from "../src/lib/schema";
import type { SearchResult, Searcher } from "../src/lib/search";
import { Trace } from "../src/lib/trace";

// Condensed from the real pages: same markers, same order.
const AUDITED = `<html><h2>Code Audit History</h2><div>2 Audits available</div>
  <div>Last Audit was delivered on Apr 19, 2021</div><div>Matic Staking Contract</div></html>`;
const NOT_AUDITED = `<html><h2>Code Audit History</h2><img src="AuditBadgeDark.svg"/>
  <span>Not Audited By CertiK</span><div>CertiK Audit No</div><div>3rd Party Audit Yes</div></html>`;

const claim: Claim = { id: "c1", type: "AUDIT", quote: "audited by CertiK", params: { auditor: "CertiK" } };
const project: Project = { chain: "base", name: "Polygon" };

function ctx(search?: Searcher): Ctx {
  return { budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000, search };
}

function stubSearch(results: SearchResult[]): Searcher & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(q) {
      queries.push(q);
      return results;
    },
  };
}

beforeEach(() => resetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("readCertikPage", () => {
  it("reads an audited page by its audit count and delivery date", () => {
    const r = readCertikPage(200, AUDITED);
    expect(r).toMatchObject({ kind: "audited", count: 2, lastDelivered: "Apr 19, 2021" });
  });

  it("reads the badge as not audited, even though the history heading is present", () => {
    // The trap from Day 1: the heading alone would have verified this page.
    expect(NOT_AUDITED).toContain("Code Audit History");
    expect(readCertikPage(200, NOT_AUDITED).kind).toBe("not-audited");
  });

  it("never leaks a half-cut HTML tag into the evidence excerpt", () => {
    // Seen on the first report page: the 12k slice ended mid-tag, leaving '<div class="skeleton-te'.
    const page = `<h2>Code Audit History</h2><span>Not Audited By CertiK</span> Missing Info? Submit Now` + " ".repeat(12_000 - 90) + `<div class="skeleton-text">`;
    const r = readCertikPage(200, page);
    expect(r.kind).toBe("not-audited");
    expect("excerpt" in r && r.excerpt).not.toMatch(/</);
    expect("excerpt" in r && r.excerpt).not.toContain("Missing Info");
  });

  it("treats a 404 as no record", () => {
    expect(readCertikPage(404, "").kind).toBe("missing");
  });

  it("refuses to call a page audited on the heading alone", () => {
    expect(readCertikPage(200, "<h2>Code Audit History</h2><div>nothing else</div>").kind).toBe("unreadable");
  });

  it("does not count zero audits as audited", () => {
    expect(readCertikPage(200, "<h2>Code Audit History</h2> 0 Audits available").kind).toBe("unreadable");
  });

  it("throws on a server error so the checker fails closed", () => {
    expect(() => readCertikPage(503, "")).toThrow();
  });
});

describe("slugs", () => {
  it("builds CertiK's slug format", () => {
    expect(certikSlug("Aerodrome Finance")).toBe("aerodrome-finance");
    expect(certikSlug("PancakeSwap")).toBe("pancakeswap");
    expect(certikSlug("  Uni-Swap v3! ")).toBe("uni-swap-v3");
  });

  it("picks the slug matching the project name, not the first result", () => {
    // Real Sep 23 result order for "PancakeSwap" included unrelated projects.
    const urls = [
      "https://skynet.certik.com/projects/four-meme",
      "https://skynet.certik.com/projects/pancakeswap",
      "https://skynet.certik.com/projects/solidus-ai-tech",
    ];
    expect(pickCertikSlug(urls, "PancakeSwap")).toBe("pancakeswap");
    expect(pickCertikSlug(urls, "Nonexistent")).toBeNull();
  });
});

describe("checkAudit", () => {
  it("VERIFIED with the scope qualifier for an audited project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(AUDITED, { status: 200 })));
    const r = await checkAudit(claim, project, ctx());
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBe(AUDIT_SCOPE_QUALIFIER);
    expect(r.evidence[0]?.url).toBe("https://skynet.certik.com/projects/polygon");
  });

  it("CONTRADICTED when CertiK's own page says not audited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(NOT_AUDITED, { status: 200 })));
    const r = await checkAudit(claim, project, ctx());
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("AUDITOR_PAGE_SAYS_NOT_AUDITED");
  });

  it("falls back to search on a 404 and re-reads the slug it finds", async () => {
    // The derived slug misses; CertiK's real slug (found by search) is audited.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/projects/polygon")
          ? new Response("not found", { status: 404 })
          : new Response(AUDITED, { status: 200 }),
      ),
    );
    const search = stubSearch([
      { url: "https://skynet.certik.com/projects/unrelated-thing", title: "", content: "" },
      { url: "https://skynet.certik.com/projects/pol-ygon", title: "", content: "" },
    ]);
    const r = await checkAudit(claim, project, ctx(search));
    expect(search.queries).toHaveLength(1);
    expect(r.verdict).toBe("VERIFIED");
    expect(r.evidence[0]?.url).toContain("/projects/pol-ygon");
  });

  it("UNVERIFIED, never CONTRADICTED, when CertiK has no page at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const r = await checkAudit(claim, project, ctx(stubSearch([])));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("NO_AUDITOR_RECORD_FOUND");
  });

  it("fails closed when CertiK is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const r = await checkAudit(claim, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });

  it("UNVERIFIED for an auditor outside the registry", async () => {
    const r = await checkAudit({ ...claim, params: { auditor: "Totally Real Audits LLC" } }, project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("AUDITOR_NOT_IN_REGISTRY");
  });
});

describe("other auditors: audit wording required, like partnerships", () => {
  it("does not treat a hack post-mortem on the auditor's blog as an audit", () => {
    // The false-✅ this rule exists for: the auditor names the project because it got exploited.
    const page = "Explained: The NovaSwap Hack. NovaSwap lost $4M to a reentrancy bug on Base.";
    expect(classifyAuditPage(page, "NovaSwap").kind).toBe("mention");
  });

  it("does not treat 'was not audited' as an audit", () => {
    expect(classifyAuditPage("NovaSwap was not audited before launch.", "NovaSwap").kind).toBe("mention");
    expect(classifyAuditPage("NovaSwap shipped without an audit.", "NovaSwap").kind).toBe("mention");
    expect(classifyAuditPage("The unaudited NovaSwap contracts were drained.", "NovaSwap").kind).toBe("mention");
  });

  it("confirms a sentence naming the project in audit terms", () => {
    expect(classifyAuditPage("Halborn completed a smart contract audit of NovaSwap in May.", "NovaSwap").kind).toBe("audit");
    expect(classifyAuditPage("NovaSwap Security Assessment — final report.", "NovaSwap").kind).toBe("audit");
  });

  it("returns MENTION_ONLY through the checker, with the page still linked", async () => {
    const search = stubSearch([
      { url: "https://halborn.com/explained-the-novaswap-hack", title: "Explained: The NovaSwap Hack", content: "NovaSwap lost $4M." },
    ]);
    const r = await checkAudit(
      { ...claim, params: { auditor: "Halborn" } },
      { chain: "base", name: "NovaSwap" },
      ctx(search),
    );
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("MENTION_ONLY");
    expect(r.evidence[0]?.url).toContain("halborn.com");
  });

  it("VERIFIED through the checker for a real audit sentence on the auditor's domain", async () => {
    const search = stubSearch([
      { url: "https://www.cyfrin.io/audits/novaswap", title: "NovaSwap Audit", content: "Cyfrin audited NovaSwap's core contracts." },
    ]);
    const r = await checkAudit({ ...claim, params: { auditor: "Cyfrin" } }, { chain: "base", name: "NovaSwap" }, ctx(search));
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toBe(AUDIT_SCOPE_QUALIFIER);
  });
});
