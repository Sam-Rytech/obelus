/**
 * Registry validation — the registries decide what counts as a primary source, so a
 * malformed or unsourced entry is a correctness bug, not a style issue.
 */
import { describe, expect, it } from "vitest";

import {
  auditors,
  exchanges,
  findAuditor,
  findExchange,
  findPartner,
  lockerAddresses,
  lockers,
  partners,
} from "../src/registry/index.js";

describe("registries load and validate", () => {
  it("parses every file through Zod at import time", () => {
    expect(exchanges.length).toBeGreaterThan(0);
    expect(auditors.length).toBeGreaterThan(0);
    expect(lockers.length).toBeGreaterThan(0);
    expect(Array.isArray(partners)).toBe(true);
  });

  it("has no duplicate ids", () => {
    for (const set of [exchanges, auditors, partners, lockers]) {
      const ids = set.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("name lookup", () => {
  it("is case- and punctuation-insensitive", () => {
    expect(findExchange("WEEX")?.id).toBe("weex");
    expect(findExchange("weex")?.id).toBe("weex");
    expect(findExchange("Gate.io")?.id).toBe("gate");
    expect(findExchange("gate io")?.id).toBe("gate");
    expect(findAuditor("certik")?.id).toBe("certik");
  });

  it("returns null for an unknown name rather than throwing", () => {
    // §3: an unknown name must become UNVERIFIED, never an error or a guess.
    expect(findExchange("NotARealExchange")).toBeNull();
    expect(findAuditor("NotARealAuditor")).toBeNull();
    expect(findPartner("NotARealPartner")).toBeNull();
    expect(findExchange("")).toBeNull();
  });
});

describe("exchange capability flags match what the spikes measured", () => {
  it("marks WEEX as able to confirm a contract and BingX as not", () => {
    // These flags decide whether a ✅ is qualified, so they are load-bearing.
    expect(findExchange("WEEX")?.canConfirmContract).toBe(true);
    expect(findExchange("BingX")?.canConfirmContract).toBe(false);
  });

  it("routes each exchange to a checker that exists", () => {
    for (const e of exchanges) {
      expect(["weex", "bingx", "ccxt"]).toContain(e.checker);
    }
  });
});

describe("locker registry", () => {
  it("stores an official docs URL for every entry", () => {
    // §9: an address with no provenance may not be used to decide a verdict.
    for (const l of lockers) {
      expect(l.source).toMatch(/^https:\/\//);
      expect(l.verifiedOnChain).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("excludes the UNCX address that is not deployed on Base", () => {
    // Published by UNCX as "Base (Uniswap V2)" but has no code on Base; including it
    // would make every Uniswap-V2-locked project look unlocked. See spike-lockers.ts.
    const undeployed = "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab";
    expect(lockerAddresses().map((l) => l.address)).not.toContain(undeployed);
  });

  it("exposes lowercased addresses for balance comparison", () => {
    const addresses = lockerAddresses();
    expect(addresses.length).toBeGreaterThan(0);
    for (const { address } of addresses) {
      expect(address).toBe(address.toLowerCase());
      expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });
});
