/**
 * Shared helpers for the Day-1B verification spikes (Progress.md §1B).
 *
 * Every spike prints a human summary, writes its raw response to spikes/out/<name>.json
 * for later shape inspection, and ends by printing the row to paste into the
 * "Spike results" table in Progress.md.
 *
 * Spikes that encode an already-settled finding also ASSERT it, so re-running them
 * doubles as a regression check against upstream changing on us mid-hackathon.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT_DIR = join(process.cwd(), "spikes", "out");

/** Browser-ish UA: some upstreams (CertiK) serve differently to bare curl/node. */
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function getJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", "user-agent": UA, ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function getText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export function save(name: string, data: unknown): string {
  const path = join(OUT_DIR, `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  // viem returns uint64/uint256 as BigInt, which JSON.stringify refuses to serialize.
  const body =
    typeof data === "string"
      ? data
      : JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  writeFileSync(path, body, "utf8");
  return path;
}

export function h(title: string): void {
  console.log(`\n=== ${title}\n`);
}

/** Assert a finding we already decoded still holds. Non-fatal by design: a spike
 *  should report everything it learned, not die on the first surprise. */
let failures = 0;
export function expect(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Print the Progress.md table row and exit non-zero if any expectation failed. */
export function done(spike: string, result: string, notes: string): void {
  console.log(`\n--- Progress.md row:`);
  console.log(`| ${spike} | ${result} | ${notes} |`);
  if (failures > 0) {
    console.log(`\n${failures} expectation(s) FAILED — upstream may have changed.`);
    process.exitCode = 1;
  }
}
