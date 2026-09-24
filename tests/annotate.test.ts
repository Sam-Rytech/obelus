import { describe, expect, it } from "vitest";

import { annotate, locateQuote, type Block } from "../src/lib/annotate";

const highlighted = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.kind === "para" ? b.para.runs.filter((r) => r.claimIds.length) : []));

describe("locateQuote", () => {
  it("finds an exact quote", () => {
    expect(locateQuote("AERO is now listed on WEEX.", "listed on WEEX")).toEqual({ start: 12, end: 26 });
  });

  it("forgives whitespace, like the quote guard, and maps back to the original text", () => {
    const text = "The token contract is\n0xabc on Base.";
    const r = locateQuote(text, "contract is 0xabc");
    expect(r && text.slice(r.start, r.end)).toBe("contract is\n0xabc");
  });

  it("returns null for a quote that isn't there", () => {
    expect(locateQuote("hello world", "goodbye")).toBeNull();
    expect(locateQuote("hello", "   ")).toBeNull();
  });
});

describe("annotate", () => {
  it("highlights each claim inside its paragraph and marks where it starts", () => {
    const text = "Intro line that is long enough to be kept as context around the claim.\n\nAERO is listed on WEEX. Audited by CertiK.";
    const { blocks, unlocated } = annotate(text, [
      { id: "c1", quote: "listed on WEEX" },
      { id: "c2", quote: "Audited by CertiK" },
    ]);
    expect(unlocated).toEqual([]);
    expect(highlighted(blocks).map((r) => [r.text, r.claimIds])).toEqual([
      ["listed on WEEX", ["c1"]],
      ["Audited by CertiK", ["c2"]],
    ]);
    const para = blocks.find((b) => b.kind === "para" && b.para.starts.length)!;
    expect(para.kind === "para" && para.para.starts).toEqual(["c1", "c2"]);
  });

  it("merges claims that share a quote into one highlight (question mode, the MBG release)", () => {
    const { blocks } = annotate("will be listed on MEXC and Gate", [
      { id: "c1", quote: "will be listed on MEXC and Gate" },
      { id: "c2", quote: "will be listed on MEXC and Gate" },
    ]);
    const runs = highlighted(blocks);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.claimIds).toEqual(["c1", "c2"]);
  });

  it("splits overlapping quotes into runs carrying every claim that covers them", () => {
    const { blocks } = annotate("A B C D", [
      { id: "x", quote: "A B C" },
      { id: "y", quote: "B C D" },
    ]);
    const para = blocks[0]!;
    expect(para.kind === "para" && para.para.runs.map((r) => [r.text, r.claimIds])).toEqual([
      ["A ", ["x"]],
      ["B C", ["x", "y"]],
      [" D", ["y"]],
    ]);
  });

  it("folds long stretches of navigation clutter but keeps short texts whole", () => {
    const nav = ["Home", "Pricing", "Newsroom", "Blog", "About", "Log in"].join("\n\n");
    const web = annotate(`${nav}\n\nThe AP3X token has been listed on MEXC.\n\n${nav}`, [
      { id: "c1", quote: "listed on MEXC" },
    ]);
    expect(web.blocks.map((b) => b.kind)).toEqual(["fold", "para", "fold"]);
    const fold = web.blocks[0]!;
    expect(fold.kind === "fold" && fold.paras).toHaveLength(6);

    const short = annotate("TEST ANNOUNCEMENT\n\nAERO update\n\nAERO is listed on WEEX.", [
      { id: "c1", quote: "listed on WEEX" },
    ]);
    expect(short.blocks.every((b) => b.kind === "para")).toBe(true);
  });

  it("never loses a claim whose quote can't be found", () => {
    const { unlocated } = annotate("some text", [{ id: "lost", quote: "not in the text" }]);
    expect(unlocated).toEqual(["lost"]);
  });
});
