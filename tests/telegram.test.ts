/**
 * Telegram replies — architecture §14. Only the formatting and input handling are tested
 * here; the webhook plumbing is grammY's.
 */
import { describe, expect, it } from "vitest";

import { escapeHtml, formatReport, inputFrom } from "../src/bot/telegram";
import type { Report } from "../src/lib/schema";

const claim = (id: string, quote: string) => ({ id, type: "OTHER", quote, params: {} });
const result = (claimId: string, verdict: string, reason: string, qualifier?: string) => ({
  claimId,
  verdict,
  reason,
  evidence: [],
  ...(qualifier ? { qualifier } : {}),
});

const report = {
  id: "AbCdEfGhIj",
  project: { chain: "base", name: "Nova <Swap>", ticker: "NOVA" },
  input: { kind: "text", value: "x", fetchedText: "x" },
  claims: [claim("c1", "listed on WEEX"), claim("c2", "audited by CertiK"), claim("c3", "partnered"), claim("c4", "TVL $1M")],
  results: [
    result("c1", "VERIFIED", "LISTED — ok"),
    result("c2", "CONTRADICTED", "AUDITOR_PAGE_SAYS_NOT_AUDITED — CertiK says no", "CertiK's page says: Not Audited By CertiK"),
    result("c3", "UNVERIFIED", "NO_PARTNER_CONFIRMATION — nothing found"),
    result("c4", "VERIFIED", "TVL — ok"),
  ],
} as unknown as Report;

describe("formatReport", () => {
  const text = formatReport(report, "https://obelus.example");

  it("leads with contradictions — what a group needs before anyone buys", () => {
    const firstClaim = text.split("\n").find((l) => /Verified|Contradicted|Unverified/.test(l) && l.includes("“"));
    expect(firstClaim).toContain("Contradicted");
  });

  it("shows at most three claims and says how many more there are", () => {
    expect(text.match(/“/g)).toHaveLength(3);
    expect(text).toContain("…and 1 more.");
  });

  it("links to the full report with its proof", () => {
    expect(text).toContain("https://obelus.example/r/AbCdEfGhIj");
  });

  it("escapes HTML from announcement-derived text", () => {
    // Project names and quotes come from untrusted input; Telegram parses HTML.
    expect(text).toContain("Nova &lt;Swap&gt;");
    expect(text).not.toContain("<Swap>");
  });

  it("labels the synthetic example as a test", () => {
    const test = {
      ...report,
      input: { ...report.input, fetchedText: "TEST ANNOUNCEMENT — written by the Obelus team for testing." },
    } as Report;
    expect(formatReport(test, "https://x")).toContain("Test announcement written by the Obelus team");
  });
});

describe("inputFrom", () => {
  it("uses the command's argument", () => {
    expect(inputFrom({ match: " https://x.com/i/status/20 ", message: {} } as never)).toBe("https://x.com/i/status/20");
  });

  it("falls back to the message being replied to", () => {
    expect(inputFrom({ match: "", message: { reply_to_message: { text: "NOVA listed on WEEX" } } } as never)).toBe(
      "NOVA listed on WEEX",
    );
  });

  it("is empty when there is nothing to check", () => {
    expect(inputFrom({ match: "", message: {} } as never)).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes the three characters Telegram's HTML mode cares about", () => {
    expect(escapeHtml("a & <b> c")).toBe("a &amp; &lt;b&gt; c");
  });
});
