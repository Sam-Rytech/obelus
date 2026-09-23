/**
 * LIQUIDITY_LOCK — architecture §10.4 (v2-style ERC-20 LP only). Driven through a fake
 * RPC client and a stubbed DexScreener response.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";

import { bps, checkLock, decideLock } from "../src/checkers/lock";
import type { Ctx } from "../src/checkers/types";
import { Budget } from "../src/lib/budget";
import type { Claim, Project } from "../src/lib/schema";
import { Trace } from "../src/lib/trace";
import { lockerAddresses } from "../src/registry/index";

const claim: Claim = { id: "c1", type: "LIQUIDITY_LOCK", quote: "liquidity is locked", params: {} };
const project: Project = { chain: "base", contract: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", contractSource: "stated" };
const LP = "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d";
const DEAD = "0x000000000000000000000000000000000000dead";

afterEach(() => vi.unstubAllGlobals());

function pairs(labels: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        { chainId: "base", dexId: "aerodrome", pairAddress: LP, labels, liquidity: { usd: 1_000_000 }, baseToken: { symbol: "AERO" }, quoteToken: { symbol: "USDC" } },
        { chainId: "base", dexId: "other", pairAddress: "0x1111111111111111111111111111111111111111", liquidity: { usd: 10 } },
      ]),
    ),
  );
}

/** Balances keyed by lowercase holder address; totalSupply fixed at 1,000,000. */
function rpc(balances: Record<string, bigint>, opts: { noTotalSupply?: boolean } = {}): PublicClient & { multicalls: number } {
  const client = {
    multicalls: 0,
    async multicall({ contracts }: { contracts: { functionName: string; args?: string[] }[] }) {
      client.multicalls++;
      return contracts.map(({ functionName, args }) => {
        if (functionName === "totalSupply") {
          return opts.noTotalSupply
            ? { status: "failure", error: new Error("execution reverted") }
            : { status: "success", result: 1_000_000n };
        }
        return { status: "success", result: balances[String(args?.[0]).toLowerCase()] ?? 0n };
      });
    },
  };
  return client as unknown as PublicClient & { multicalls: number };
}

const ctx = (client: PublicClient): Ctx => ({ budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000, rpc: client });

describe("decideLock thresholds", () => {
  it("VERIFIED at >= 90% locked or burned", () => {
    expect(decideLock(9_000, 0, ["UNCX"]).verdict).toBe("VERIFIED");
    expect(decideLock(4_000, 5_000, []).verdict).toBe("VERIFIED");
  });

  it("VERIFIED but qualified as partial between 10% and 90%", () => {
    const d = decideLock(2_500, 0, ["UNCX"]);
    expect(d.verdict).toBe("VERIFIED");
    expect(d.qualifier).toContain("Partially locked: 25%");
  });

  it("UNVERIFIED — never CONTRADICTED — below 10%", () => {
    // Our registry knows two lockers; LP elsewhere is absence of proof, not disproof (§3).
    const d = decideLock(500, 0, []);
    expect(d.verdict).toBe("UNVERIFIED");
    expect(d.reason).toContain("LP_NOT_IN_KNOWN_LOCKER");
  });

  it("computes basis points exactly on large integers", () => {
    expect(bps(10n ** 30n, 4n * 10n ** 30n)).toBe(2_500);
    expect(bps(1n, 0n)).toBe(0);
  });
});

describe("checkLock", () => {
  it("VERIFIED when the LP sits in a registered locker", async () => {
    pairs();
    const locker = lockerAddresses()[0]!.address;
    const r = await checkLock(claim, project, ctx(rpc({ [locker]: 950_000n })));
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toContain("Locked 95%");
  });

  it("counts burned LP toward the total", async () => {
    pairs();
    const r = await checkLock(claim, project, ctx(rpc({ [DEAD]: 1_000_000n })));
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toContain("burned 100%");
  });

  it("reads everything in a single multicall, to survive public-RPC rate limits", async () => {
    pairs();
    const client = rpc({});
    await checkLock(claim, project, ctx(client));
    expect(client.multicalls).toBe(1);
  });

  it("uses the highest-liquidity Base pool", async () => {
    pairs();
    const r = await checkLock(claim, project, ctx(rpc({})));
    expect(r.evidence[0]?.url).toBe(`https://dexscreener.com/base/${LP}`);
  });

  it("UNVERIFIED for a labelled v3/v4 pool — NFT positions aren't ERC-20 LP", async () => {
    pairs(["v3"]);
    const r = await checkLock(claim, project, ctx(rpc({})));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("LOCK_TYPE_NOT_SUPPORTED_V1");
  });

  it("UNVERIFIED for an unlabelled pool with no totalSupply()", async () => {
    // Second guard: a CL pool DexScreener forgot to label.
    pairs();
    const r = await checkLock(claim, project, ctx(rpc({}, { noTotalSupply: true })));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("LOCK_TYPE_NOT_SUPPORTED_V1");
  });

  it("UNVERIFIED with no contract to look up", async () => {
    const r = await checkLock(claim, { chain: "base" }, ctx(rpc({})));
    expect(r.reason).toContain("NO_CONTRACT_RESOLVED");
  });

  it("fails closed when DexScreener is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const r = await checkLock(claim, project, ctx(rpc({})));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
  });
});
