/**
 * LIQUIDITY_LOCK checker — architecture §10.4 (v2-style ERC-20 LP only).
 *
 * 1. DexScreener: the token's Base pairs; take the top one by liquidity.
 * 2. v2-style only. Verified Sep 22: concentrated-liquidity pairs carry `labels`
 *    (["v3"], ["v4"]); v2-style ERC-20 LP pairs have none. As a second guard, an LP
 *    without `totalSupply()` is not an ERC-20 LP and is also unsupported.
 * 3. On-chain: LP totalSupply, balanceOf each registered locker, balanceOf burn
 *    addresses. locked% and burned% are computed separately.
 *
 * Rules:
 *   locked% + burned% >= 90   -> VERIFIED
 *   >= 10                     -> VERIFIED, qualifier "Partially locked"
 *   <  10                     -> UNVERIFIED LP_NOT_IN_KNOWN_LOCKER
 *
 * < 10% is UNVERIFIED, not CONTRADICTED: the locker registry has two entries, so LP
 * sitting in any other legitimate locker would otherwise be stamped ❌ on nothing but
 * our own ignorance (§3). The CONTRADICTED case in §10.4 — LP held by an EOA or the
 * deployer — needs a holder list, which plain RPC can't enumerate; it is not built in v1.
 */
import { getAddress, type Address, type ContractFunctionParameters, type PublicClient } from "viem";

import { REASON, type Claim, type Project } from "../lib/schema";
import { lockerAddresses } from "../registry/index";
import { createBaseClient } from "./ownership";
import { evidence, failClosed, getJson, result, type Ctx } from "./types";

const TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/base/";
const BURN = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"] as const;

const ERC20 = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

type Pair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  liquidity?: { usd?: number };
  baseToken?: { address: string; symbol: string };
  quoteToken?: { symbol: string };
};

export type LockDecision = { verdict: "VERIFIED" | "UNVERIFIED"; reason: string; qualifier: string };

/** Basis points of `part` in `total`, safe for bigints of any size. */
export function bps(part: bigint, total: bigint): number {
  return total > 0n ? Number((part * 10_000n) / total) : 0;
}

/** Pure: the §10.4 thresholds. Exported for exhaustive testing. */
export function decideLock(
  lockedBps: number,
  burnedBps: number,
  lockerNames: string[],
): LockDecision {
  const total = lockedBps + burnedBps;
  const pct = (n: number) => `${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}%`;
  const where = lockerNames.length ? ` in ${lockerNames.join(", ")}` : "";

  if (total >= 9_000) {
    return {
      verdict: "VERIFIED",
      reason: `${REASON.LP_LOCKED} — ${pct(total)} of the LP is locked or burned`,
      qualifier: `Locked ${pct(lockedBps)}${where}${burnedBps ? `, burned ${pct(burnedBps)}` : ""}`,
    };
  }
  if (total >= 1_000) {
    return {
      verdict: "VERIFIED",
      reason: `${REASON.LP_PARTIALLY_LOCKED} — only ${pct(total)} of the LP is locked or burned`,
      qualifier: `Partially locked: ${pct(total)}`,
    };
  }
  return {
    verdict: "UNVERIFIED",
    reason: `${REASON.LP_NOT_IN_KNOWN_LOCKER} — ${pct(total)} of the LP is in a known locker or burned; it may sit in a locker Obelus doesn't know`,
    qualifier: "LP not found in a known locker",
  };
}

export async function checkLock(claim: Claim, project: Project, ctx: Ctx) {
  if (!project.contract) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NO_CONTRACT_RESOLVED} — no token contract was stated or resolved`,
      [],
      "No contract address",
    );
  }

  try {
    const token = getAddress(project.contract);
    ctx.budget.spend("dexscreener:pairs");
    const pairs = await getJson<Pair[]>(`${TOKEN_PAIRS}${token}`, ctx);
    const top = (Array.isArray(pairs) ? pairs : [])
      .filter((p) => p.chainId === "base")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (!top) {
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.LOCK_TYPE_NOT_SUPPORTED_V1} — DexScreener lists no Base pool for this token`,
        [evidence("DexScreener", `${TOKEN_PAIRS}${token}`, "0 Base pairs")],
        "No liquidity pool found",
      );
    }

    const pairUrl = `https://dexscreener.com/base/${top.pairAddress}`;
    const pairDesc = `${top.dexId} ${top.baseToken?.symbol ?? "?"}/${top.quoteToken?.symbol ?? "?"} pool ${top.pairAddress}, liquidity $${Math.round(top.liquidity?.usd ?? 0).toLocaleString("en-US")}`;

    if (top.labels?.length) {
      ctx.trace.step(`Lock: top pool is ${top.dexId} ${top.labels.join("/")} — not an ERC-20 LP`);
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.LOCK_TYPE_NOT_SUPPORTED_V1} — the main pool is ${top.labels.join("/")} (concentrated liquidity), whose positions are NFTs, not lockable ERC-20 LP`,
        [evidence("DexScreener", pairUrl, `${pairDesc}, labels=${top.labels.join(",")}`)],
        `${top.labels.join("/")} pool — not checkable in v1`,
      );
    }

    const client: PublicClient = ctx.rpc ?? createBaseClient();
    const lp = getAddress(top.pairAddress) as Address;
    ctx.budget.spend("base:lp-reads");

    // Every read in ONE eth_call via Multicall3: the public Base RPC rate-limits at ~5
    // concurrent requests, and five separate reads failed the first live run.
    const lockers = lockerAddresses();
    const holders = [...lockers.map((l) => l.address), ...BURN];
    // Typed as a plain array: viem otherwise infers every entry from the mapped
    // balanceOf calls and rejects the leading totalSupply.
    const contracts: ContractFunctionParameters<typeof ERC20>[] = [
      { address: lp, abi: ERC20, functionName: "totalSupply" },
      ...holders.map((h) => ({
        address: lp,
        abi: ERC20,
        functionName: "balanceOf" as const,
        args: [getAddress(h) as Address] as const,
      })),
    ];
    const reads = await client.multicall({ allowFailure: true, contracts });

    const supplyRead = reads[0];
    if (!supplyRead || supplyRead.status !== "success") {
      // No totalSupply() => not an ERC-20 LP (e.g. an unlabelled CL pool).
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.LOCK_TYPE_NOT_SUPPORTED_V1} — the main pool has no ERC-20 LP token to read`,
        [evidence("DexScreener", pairUrl, pairDesc)],
        "Pool type not checkable in v1",
      );
    }
    const totalSupply = supplyRead.result as bigint;

    const balances = reads.slice(1).map((r) => {
      // A failed balanceOf on a real ERC-20 means the read itself broke: fail closed.
      if (r.status !== "success") throw new Error("balanceOf read failed");
      return r.result as bigint;
    });
    const lockerBals = balances.slice(0, lockers.length);
    const burnBals = balances.slice(lockers.length);

    const lockedSum = lockerBals.reduce((a, b) => a + b, 0n);
    const burnedSum = burnBals.reduce((a, b) => a + b, 0n);
    const holding = lockers.filter((_, i) => (lockerBals[i] ?? 0n) > 0n).map((l) => l.name);
    const decision = decideLock(bps(lockedSum, totalSupply), bps(burnedSum, totalSupply), holding);

    const breakdown = [
      ...lockers.map((l, i) => `${l.name}: ${bps(lockerBals[i] ?? 0n, totalSupply) / 100}%`),
      `burned: ${bps(burnedSum, totalSupply) / 100}%`,
    ].join("; ");

    ctx.trace.step(`Lock: ${top.dexId} LP — ${breakdown}`);

    return result(claim, decision.verdict, decision.reason, [
      evidence("DexScreener", pairUrl, pairDesc),
      evidence(
        "Base RPC",
        `https://basescan.org/token/${lp}#balances`,
        `LP totalSupply ${totalSupply}; ${breakdown}`,
      ),
    ], decision.qualifier);
  } catch (err) {
    return failClosed("lock", claim, err);
  }
}
