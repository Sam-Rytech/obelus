/**
 * Receipt networks. The one property that must never break: switching receipts to a
 * testnet must not move the CHECKERS off mainnet, where the tokens being checked live.
 */
import { afterEach, describe, expect, it } from "vitest";

import { currentEasChain, easChainById, easRpcUrl } from "../src/lib/chains";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("receipt network", () => {
  it("defaults to Base mainnet", () => {
    delete process.env.EAS_CHAIN;
    expect(currentEasChain().id).toBe("base");
    expect(currentEasChain().chain.id).toBe(8453);
  });

  it("switches to Base Sepolia, labelled as a testnet", () => {
    process.env.EAS_CHAIN = "base-sepolia";
    const net = currentEasChain();
    expect(net.chain.id).toBe(84532);
    expect(net.testnet).toBe(true);
    expect(net.label).toContain("testnet");
    expect(net.easscan).toBe("https://base-sepolia.easscan.org");
  });

  it("never uses the checkers' mainnet RPC for receipts", () => {
    // BASE_RPC_URL points the ownership/lock checkers at mainnet; receipts must not follow it.
    process.env.BASE_RPC_URL = "https://mainnet-checkers.example";
    process.env.EAS_CHAIN = "base-sepolia";
    delete process.env.EAS_RPC_URL;
    expect(easRpcUrl()).toBe("https://sepolia.base.org");
  });

  it("reads a receipt from the network it records, defaulting old receipts to mainnet", () => {
    expect(easChainById("base-sepolia").rpc).toBe("https://sepolia.base.org");
    expect(easChainById(undefined).id).toBe("base");
    expect(easChainById("nonsense").id).toBe("base");
  });
});
