/**
 * Report hashing — architecture §11. The verify page recomputes this in the browser
 * from the stored JSON, so canonicalization must be independent of key order and
 * survive a JSON round-trip, or every honest report would fail verification.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson, reportHash } from "../src/lib/hash";

describe("canonicalJson", () => {
  it("sorts keys at every depth and removes whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("ignores key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("keeps array order — claim order is meaningful", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("drops undefined fields exactly as a JSON round-trip would", () => {
    const withUndefined = { a: 1, b: undefined as unknown };
    expect(canonicalJson(withUndefined)).toBe(canonicalJson(JSON.parse(JSON.stringify(withUndefined))));
  });

  it("escapes strings the way JSON does", () => {
    expect(canonicalJson({ q: 'He said "listed"\n' })).toBe('{"q":"He said \\"listed\\"\\n"}');
  });
});

describe("reportHash", () => {
  const report = {
    id: "abc",
    summary: "s",
    results: [{ claimId: "c1", verdict: "VERIFIED" }],
    reportHash: "",
  };

  it("is a 32-byte hex keccak", () => {
    expect(reportHash(report)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("survives a JSON round-trip — the verify page's exact situation", () => {
    expect(reportHash(JSON.parse(JSON.stringify(report)))).toBe(reportHash(report));
  });

  it("excludes the attestation, which is added after hashing", () => {
    expect(reportHash({ ...report, attestation: { uid: "0x1", txHash: "0x2" } })).toBe(reportHash(report));
  });

  it("excludes its own reportHash field, which can't hash itself", () => {
    expect(reportHash({ ...report, reportHash: "0xdeadbeef" })).toBe(reportHash(report));
  });

  it("changes when any verdict is edited — the point of the receipt", () => {
    const tampered = { ...report, results: [{ claimId: "c1", verdict: "CONTRADICTED" }] };
    expect(reportHash(tampered)).not.toBe(reportHash(report));
  });
});
