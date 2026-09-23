/**
 * Report hashing — architecture §11.
 *
 * reportHash = keccak256(canonical JSON of the report WITHOUT `attestation`), where
 * canonical means: object keys sorted recursively, no whitespace, array order kept,
 * undefined fields dropped.
 *
 * This runs on the server when the report is created AND in the browser on the verify
 * page, so it must stay isomorphic: viem's keccak256 only, no Node APIs. If the two
 * sides ever disagree on canonicalization, every honest report would fail
 * verification — hence the tests on key order and undefined handling.
 */
import { keccak256, toBytes } from "viem";

/** Deterministic JSON: sorted keys at every depth, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // JSON.stringify handles strings/numbers/booleans/null exactly like JSON would.
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // JSON.stringify turns undefined array slots into null; mirror that.
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** Everything that is hashed: the report minus its attestation and minus the hash itself. */
export function hashableReport<T extends Record<string, unknown>>(report: T): Omit<T, "attestation" | "reportHash"> {
  const { attestation: _a, reportHash: _h, ...rest } = report;
  void _a;
  void _h;
  return rest;
}

export function reportHash(report: Record<string, unknown>): `0x${string}` {
  return keccak256(toBytes(canonicalJson(hashableReport(report))));
}
