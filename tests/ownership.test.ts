/**
 * OWNERSHIP_RENOUNCED — architecture §10.3.
 *
 * Driven through a fake viem client so every branch is deterministic and offline.
 * The case that matters most is the last one: a renounced owner on an upgradeable
 * proxy, which looks safe but is not.
 */
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";

import { checkOwnership } from "../src/checkers/ownership.js";
import { Budget } from "../src/lib/budget.js";
import { Trace } from "../src/lib/trace.js";
import type { Claim, Project } from "../src/lib/schema.js";
import type { Ctx } from "../src/checkers/types.js";

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ZERO_WORD = `0x${"0".repeat(64)}`;

const claim: Claim = {
  id: "c1",
  type: "OWNERSHIP_RENOUNCED",
  quote: "ownership has been renounced",
  params: {},
};

const project: Project = {
  chain: "base",
  contract: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
};

function ctx(): Ctx {
  return { budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000 };
}

function word(address: string): string {
  return `0x${"0".repeat(24)}${address.replace(/^0x/, "").toLowerCase()}`;
}

/** Minimal viem stand-in: owner() result plus the two EIP-1967 slots. */
function fakeClient(opts: {
  owner?: string | null;
  implementation?: string | null;
  admin?: string | null;
}): PublicClient {
  return {
    async readContract() {
      if (opts.owner === null || opts.owner === undefined) throw new Error("execution reverted");
      return opts.owner;
    },
    async getStorageAt({ slot }: { slot: string }) {
      const value = slot === IMPLEMENTATION_SLOT ? opts.implementation : opts.admin;
      return value ? word(value) : ZERO_WORD;
    },
  } as unknown as PublicClient;
}

describe("ownership renouncement", () => {
  it("VERIFIED when owner is the zero address and it is not a proxy", () => {
    return checkOwnership(claim, project, ctx(), fakeClient({ owner: `0x${"0".repeat(40)}` })).then((r) => {
      expect(r.verdict).toBe("VERIFIED");
      expect(r.reason).toContain("OWNER_RENOUNCED");
    });
  });

  it("VERIFIED when owner is the dead address", async () => {
    const r = await checkOwnership(
      claim,
      project,
      ctx(),
      fakeClient({ owner: "0x000000000000000000000000000000000000dEaD" }),
    );
    expect(r.verdict).toBe("VERIFIED");
  });

  it("CONTRADICTED when a real address still owns the contract", async () => {
    const owner = "0x1111111111111111111111111111111111111111";
    const r = await checkOwnership(claim, project, ctx(), fakeClient({ owner }));
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("OWNER_IS");
    expect(r.qualifier).toContain(owner);
  });

  it("CONTRADICTED when ownership is renounced but the proxy is still upgradeable", async () => {
    // The deception this checker exists for: owner() reads as burned, so a naive
    // check says "safe", while the admin can still swap the implementation.
    const admin = "0x2222222222222222222222222222222222222222";
    const r = await checkOwnership(
      claim,
      project,
      ctx(),
      fakeClient({
        owner: `0x${"0".repeat(40)}`,
        implementation: "0x3333333333333333333333333333333333333333",
        admin,
      }),
    );
    expect(r.verdict).toBe("CONTRADICTED");
    expect(r.reason).toContain("RENOUNCED_BUT_UPGRADEABLE");
    expect(r.qualifier).toContain(admin);
  });

  it("VERIFIED for a proxy whose admin is also burned", async () => {
    const r = await checkOwnership(
      claim,
      project,
      ctx(),
      fakeClient({
        owner: `0x${"0".repeat(40)}`,
        implementation: "0x3333333333333333333333333333333333333333",
        admin: null,
      }),
    );
    expect(r.verdict).toBe("VERIFIED");
  });

  it("UNVERIFIED when the contract has no owner function", async () => {
    // No owner to renounce is not the same as having renounced one (§3).
    const r = await checkOwnership(claim, project, ctx(), fakeClient({ owner: null }));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("NO_OWNER_FUNCTION");
  });

  it("UNVERIFIED when no contract address is known", async () => {
    const r = await checkOwnership(claim, { chain: "base" }, ctx(), fakeClient({ owner: null }));
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("NO_CONTRACT_RESOLVED");
  });

  it("UNVERIFIED, not a guess, when the RPC fails", async () => {
    // §18 fail closed: a source we could not read is not evidence of anything.
    const broken = {
      async readContract() {
        throw new Error("boom");
      },
      async getStorageAt() {
        throw new Error("boom");
      },
    } as unknown as PublicClient;

    const r = await checkOwnership(claim, project, ctx(), broken);
    expect(r.verdict).toBe("UNVERIFIED");
  });

  it("attaches a basescan link a human can open", async () => {
    const r = await checkOwnership(claim, project, ctx(), fakeClient({ owner: `0x${"0".repeat(40)}` }));
    expect(r.evidence[0]?.url).toContain("basescan.org/address/");
  });

  it("spends exactly one unit of the tool budget", async () => {
    const c = ctx();
    await checkOwnership(claim, project, c, fakeClient({ owner: `0x${"0".repeat(40)}` }));
    expect(c.budget.spent).toBe(1);
  });
});
