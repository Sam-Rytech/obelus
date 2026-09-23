import { describe, expect, it } from "vitest";

import { looksLikeQuestion } from "../src/lib/summary";

describe("looksLikeQuestion", () => {
  it("recognises questions", () => {
    for (const q of ["is $BTC listed?", "Is AERO audited by CertiK", "has NOVA renounced ownership", "listed on bingx?"]) {
      expect(looksLikeQuestion(q), q).toBe(true);
    }
  });

  it("leaves announcements alone", () => {
    for (const a of [
      "BTC is now listed on WEEX",
      "Issued today: NOVA is audited by CertiK",
      "https://x.com/i/status/123",
      "",
      `Whatever happens? ${"long announcement text ".repeat(20)}`,
    ]) {
      expect(looksLikeQuestion(a), a.slice(0, 40)).toBe(false);
    }
  });
});
