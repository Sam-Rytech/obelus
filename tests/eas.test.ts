/**
 * Receipts — architecture §11. The browser verify page decodes what the server encoded,
 * so the two must round-trip exactly, and the schema UID must never drift (it is derived
 * from the schema string, and every past receipt points at it).
 */
import { describe, expect, it } from "vitest";

import { decodeReceipt, encodeReceipt, receiptData, SCHEMA, schemaUid } from "../src/lib/eas";
import type { Report } from "../src/lib/schema";

const report = {
  id: "AbCdEfGhIj",
  reportHash: `0x${"ab".repeat(32)}`,
  engineVersion: "e321921",
  results: [
    { claimId: "c1", verdict: "VERIFIED", reason: "R", evidence: [] },
    { claimId: "c2", verdict: "CONTRADICTED", reason: "R", evidence: [] },
    { claimId: "c3", verdict: "UNVERIFIED", reason: "R", evidence: [] },
    { claimId: "c4", verdict: "UNVERIFIED", reason: "R", evidence: [] },
  ],
} as unknown as Report;

describe("schema", () => {
  it("is exactly the §11 string — reformatting it would change the UID", () => {
    expect(SCHEMA).toBe(
      "bytes32 reportHash, string reportUrl, uint8 verified, uint8 contradicted, uint8 unverified, string engineVersion",
    );
  });

  it("derives a stable UID (EAS: keccak256(schema, resolver, revocable))", () => {
    expect(schemaUid()).toBe("0xd10de7a26498141ed49821edd46d02ed04da1653b5c80a7125a580ab3ac4ac05");
  });
});

describe("receipt data", () => {
  it("counts verdicts and builds the report URL", () => {
    const d = receiptData(report, "https://obelus.example/");
    expect(d).toMatchObject({ verified: 1, contradicted: 1, unverified: 2, engineVersion: "e321921" });
    expect(d.reportUrl).toBe("https://obelus.example/r/AbCdEfGhIj");
  });

  it("round-trips through ABI encoding, as the verify page relies on", () => {
    const d = receiptData(report, "https://obelus.example");
    expect(decodeReceipt(encodeReceipt(d))).toEqual(d);
  });
});
