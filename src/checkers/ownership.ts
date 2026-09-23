/**
 * OWNERSHIP_RENOUNCED checker — architecture §10.3.
 *
 * "Ownership renounced" is a safety claim: it is supposed to mean nobody can change
 * the token any more. Reading `owner()` alone is not enough to confirm that, because a
 * PROXY can have a renounced implementation while remaining fully upgradeable by its
 * admin. That combination — renounced owner, live proxy admin — is the interesting
 * deception, so it is checked explicitly and reported as CONTRADICTED.
 *
 * Every verdict here comes from a Base RPC read, with basescan as the human-checkable
 * evidence URL.
 */
import { createPublicClient, http, getAddress, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";

import { REASON, type Claim, type Project } from "../lib/schema";
import { evidence, failClosed, result, type Ctx } from "./types";

/** EIP-1967 storage slots — architecture §10.3 step 2. */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

const OWNER_ABI = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

/** Some tokens expose getOwner() (BEP-20 style) instead of owner(). */
const GET_OWNER_ABI = [
  { name: "getOwner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

function isBurnAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  return a === ZERO || a === DEAD;
}

/** The low 20 bytes of a 32-byte storage word hold the address. */
function addressFromSlot(word: string | undefined): string | null {
  if (!word || word.length < 66) return null;
  const addr = `0x${word.slice(-40)}`.toLowerCase();
  return addr === ZERO ? null : addr;
}

/**
 * Measured Sep 23: mainnet.base.org answers `429 over rate limit` beyond ~5 concurrent
 * requests, and JSON-RPC batching does not help (0/8 succeeded). So: back off and retry
 * here, collapse reads into Multicall3 where possible (see lock.ts), and set an Alchemy
 * URL in BASE_RPC_URL for production (architecture §20).
 */
export function createBaseClient(): PublicClient {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org", {
      retryCount: 4,
      retryDelay: 400, // viem backs off exponentially from this base
    }),
  }) as PublicClient;
}

export async function checkOwnership(
  claim: Claim,
  project: Project,
  ctx: Ctx,
  client: PublicClient = ctx.rpc ?? createBaseClient(),
) {
  try {
    if (!project.contract) {
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.NO_CONTRACT_RESOLVED} — no token contract was stated or resolved, so there is nothing to read`,
        [],
        "No contract address",
      );
    }

    const address = getAddress(project.contract) as Address;
    const explorer = `https://basescan.org/address/${address}#readContract`;
    ctx.budget.spend("base:ownership");

    // Read owner and both proxy slots together: three cheap reads, one round trip.
    const [ownerRaw, implSlot, adminSlot] = await Promise.all([
      client
        .readContract({ address, abi: OWNER_ABI, functionName: "owner" })
        .catch(() =>
          client.readContract({ address, abi: GET_OWNER_ABI, functionName: "getOwner" }).catch(() => null),
        ),
      client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT }).catch(() => undefined),
      client.getStorageAt({ address, slot: ADMIN_SLOT }).catch(() => undefined),
    ]);

    const implementation = addressFromSlot(implSlot);
    const proxyAdmin = addressFromSlot(adminSlot);
    const isProxy = implementation !== null;

    const ev = [
      evidence(
        "Base RPC",
        explorer,
        `owner() = ${ownerRaw ?? "reverted / not present"}; EIP-1967 implementation = ${implementation ?? "none"}; EIP-1967 admin = ${proxyAdmin ?? "none"}`,
      ),
    ];

    ctx.trace.step(
      `Ownership: owner=${ownerRaw ?? "none"}${isProxy ? `, proxy impl=${implementation?.slice(0, 10)}…` : ", not a proxy"}`,
    );

    if (!ownerRaw) {
      // No owner function at all. Common for genuinely immutable tokens, but it is not
      // proof of renouncement — there was never an owner to renounce (§3).
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.NO_OWNER_FUNCTION} — the contract exposes neither owner() nor getOwner(), so renouncement cannot be confirmed`,
        ev,
        "No owner() function to read",
      );
    }

    const owner = String(ownerRaw).toLowerCase();

    if (!isBurnAddress(owner)) {
      return result(
        claim,
        "CONTRADICTED",
        `${REASON.OWNER_IS} ${owner} — ownership has not been renounced`,
        ev,
        `Owner is ${owner}`,
      );
    }

    // Owner is burned. But if it is an upgradeable proxy with a live admin, the code
    // behind the token can still be replaced — the claim's substance is false.
    if (isProxy && proxyAdmin && !isBurnAddress(proxyAdmin)) {
      return result(
        claim,
        "CONTRADICTED",
        `${REASON.RENOUNCED_BUT_UPGRADEABLE} — owner is ${owner}, but this is an EIP-1967 proxy whose admin ${proxyAdmin} can still replace the implementation`,
        ev,
        `Owner renounced, but contract is upgradeable by admin ${proxyAdmin}`,
      );
    }

    return result(
      claim,
      "VERIFIED",
      `${REASON.OWNER_RENOUNCED} — owner() returns ${owner}${isProxy ? " and the proxy admin is also burned" : " and the contract is not an EIP-1967 proxy"}`,
      ev,
    );
  } catch (err) {
    return failClosed("ownership", claim, err);
  }
}
