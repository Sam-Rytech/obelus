/**
 * Where receipts are written — architecture §11.
 *
 * RECEIPTS ONLY. The checkers always read Base MAINNET (BASE_RPC_URL), because that is
 * where the tokens being checked live. `EAS_CHAIN` decides where the fingerprint of a
 * report is recorded: Base Sepolia while testing (free faucet ETH), Base mainnet for the
 * demo. EAS is an OP-stack predeploy at the same addresses on both (verified Sep 24).
 *
 * Isomorphic: the verify page uses this in the browser to read the right network.
 */
import { base, baseSepolia, type Chain } from "viem/chains";

export type EasChainId = "base" | "base-sepolia";

export type EasChain = {
  id: EasChainId;
  chain: Chain;
  label: string;
  testnet: boolean;
  rpc: string;
  easscan: string;
  explorer: string;
};

export const EAS_CHAINS: Record<EasChainId, EasChain> = {
  base: {
    id: "base",
    chain: base,
    label: "Base",
    testnet: false,
    rpc: "https://mainnet.base.org",
    easscan: "https://base.easscan.org",
    explorer: "https://basescan.org",
  },
  "base-sepolia": {
    id: "base-sepolia",
    chain: baseSepolia,
    label: "Base Sepolia (testnet)",
    testnet: true,
    rpc: "https://sepolia.base.org",
    easscan: "https://base-sepolia.easscan.org",
    explorer: "https://sepolia.basescan.org",
  },
};

export function easChainById(id: string | undefined): EasChain {
  return EAS_CHAINS[(id as EasChainId) ?? "base"] ?? EAS_CHAINS.base;
}

/** Server-side: the network new receipts are written to. */
export function currentEasChain(): EasChain {
  return easChainById(process.env.EAS_CHAIN);
}

/** RPC for the receipt network. Never BASE_RPC_URL, which is the checkers' mainnet RPC. */
export function easRpcUrl(c: EasChain = currentEasChain()): string {
  return process.env.EAS_RPC_URL || c.rpc;
}
