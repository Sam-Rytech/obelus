/**
 * Register the Obelus receipt schema on Base's EAS SchemaRegistry — architecture §11.
 *
 *   pnpm spike scripts/register-schema.ts          dry run: check the chain, send nothing
 *   pnpm spike scripts/register-schema.ts --send   register it (one transaction, attester pays)
 *
 * Schema UIDs are deterministic, so this first checks whether the identical schema is
 * already registered; if it is, there is nothing to send and that UID is simply reused.
 * Either way it writes EAS_SCHEMA_UID into .env.local.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, zeroAddress, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import {
  SCHEMA,
  SCHEMA_REGISTRY_ABI,
  SCHEMA_REGISTRY_ADDRESS,
  SCHEMA_REVOCABLE,
  rpcUrl,
  schemaUid,
} from "../src/lib/eas";

function writeEnv(key: string, value: string) {
  const path = ".env.local";
  let env = readFileSync(path, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(path, env);
}

async function main() {
  const uid = schemaUid();
  const reader = createPublicClient({ chain: base, transport: http(rpcUrl(), { retryCount: 4, retryDelay: 400 }) });

  console.log(`schema : ${SCHEMA}`);
  console.log(`uid    : ${uid}`);

  const existing = await reader.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "getSchema",
    args: [uid],
  });

  if (existing.uid !== zeroHash) {
    console.log(`\nAlready registered on Base — no transaction needed.`);
    console.log(`view   : https://base.easscan.org/schema/view/${uid}`);
    writeEnv("EAS_SCHEMA_UID", uid);
    console.log("EAS_SCHEMA_UID written to .env.local");
    return;
  }

  const pk = process.env.ATTESTER_PRIVATE_KEY;
  if (!pk) throw new Error("ATTESTER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
  const balance = await reader.getBalance({ address: account.address });
  console.log(`\nNot registered yet.`);
  console.log(`attester ${account.address} holds ${formatEther(balance)} ETH on Base`);

  if (!process.argv.includes("--send")) {
    console.log("\nDry run — nothing sent. Re-run with --send to register (one transaction).");
    return;
  }
  if (balance === 0n) throw new Error("the attester wallet has no ETH on Base — fund it first");

  const wallet = createWalletClient({ account, chain: base, transport: http(rpcUrl()) });
  const hash = await wallet.writeContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "register",
    args: [SCHEMA, zeroAddress, SCHEMA_REVOCABLE],
  });
  console.log(`tx     : https://basescan.org/tx/${hash}`);
  const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("registration reverted");

  writeEnv("EAS_SCHEMA_UID", uid);
  console.log(`\nRegistered. https://base.easscan.org/schema/view/${uid}`);
  console.log("EAS_SCHEMA_UID written to .env.local");
}

main().catch((e) => {
  console.error("register-schema failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
