/**
 * Receipts on Base via EAS — architecture §11.
 *
 * Every report is attested on Base — Sepolia while testing, mainnet for the demo, chosen
 * by EAS_CHAIN (see chains.ts): its keccak256 hash, its URL and its verdict counts,
 * signed by a dedicated attester wallet (never the registered hackathon wallet).
 * Anyone can then re-hash the report JSON and compare it to the chain, which is what
 * /r/[id]/verify does in the browser.
 *
 * Attestation happens AFTER the report is stored and the user has their link — a
 * receipt must never block the user on gas (§11). If it fails, the report simply shows
 * "receipt pending".
 */
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodePacked,
  http,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { currentEasChain, easRpcUrl, type EasChainId } from "./chains";
import type { Report } from "./schema";

export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;

/** Exactly as in architecture §11. The string is hashed into the schema UID, so never reformat it. */
export const SCHEMA =
  "bytes32 reportHash, string reportUrl, uint8 verified, uint8 contradicted, uint8 unverified, string engineVersion";
export const SCHEMA_PARAMS = parseAbiParameters(SCHEMA);

/** Non-revocable (§11): a receipt that could be withdrawn isn't a receipt. No resolver. */
export const SCHEMA_REVOCABLE = false;

/** EAS derives a schema's UID deterministically: keccak256(schema, resolver, revocable). */
export function schemaUid(): Hex {
  return keccak256(encodePacked(["string", "address", "bool"], [SCHEMA, zeroAddress, SCHEMA_REVOCABLE]));
}

export const EAS_ABI = [
  {
    name: "attest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getAttestation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
  {
    name: "Attested",
    type: "event",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "uid", type: "bytes32", indexed: false },
      { name: "schemaUID", type: "bytes32", indexed: true },
    ],
  },
] as const;

export const SCHEMA_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getSchema",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "schema", type: "string" },
        ],
      },
    ],
  },
] as const;

export type ReceiptData = {
  reportHash: Hex;
  reportUrl: string;
  verified: number;
  contradicted: number;
  unverified: number;
  engineVersion: string;
};

export function receiptData(report: Report, baseUrl: string): ReceiptData {
  const n = (v: string) => Math.min(255, report.results.filter((r) => r.verdict === v).length); // uint8
  return {
    reportHash: report.reportHash as Hex,
    reportUrl: `${baseUrl.replace(/\/$/, "")}/r/${report.id}`,
    verified: n("VERIFIED"),
    contradicted: n("CONTRADICTED"),
    unverified: n("UNVERIFIED"),
    engineVersion: report.engineVersion,
  };
}

export function encodeReceipt(d: ReceiptData): Hex {
  return encodeAbiParameters(SCHEMA_PARAMS, [
    d.reportHash,
    d.reportUrl,
    d.verified,
    d.contradicted,
    d.unverified,
    d.engineVersion,
  ]);
}

/** Isomorphic: the verify page decodes attestation data with this in the browser. */
export function decodeReceipt(data: Hex): ReceiptData {
  const [reportHash, reportUrl, verified, contradicted, unverified, engineVersion] = decodeAbiParameters(
    SCHEMA_PARAMS,
    data,
  );
  return { reportHash, reportUrl, verified, contradicted, unverified, engineVersion };
}

export function easConfigured(): boolean {
  return Boolean(process.env.ATTESTER_PRIVATE_KEY && process.env.EAS_SCHEMA_UID);
}

/**
 * Attest a report on Base. Returns null (receipt pending) when not configured; throws on
 * a failed transaction so the caller can log it — the report itself is already saved.
 */
export async function attestReport(
  report: Report,
): Promise<{ uid: Hex; txHash: Hex; chain: EasChainId } | null> {
  const pk = process.env.ATTESTER_PRIVATE_KEY;
  const schema = process.env.EAS_SCHEMA_UID as Hex | undefined;
  if (!pk || !schema) return null;

  // The RECEIPT network (EAS_CHAIN), not the checkers' mainnet RPC.
  const net = currentEasChain();
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
  const transport = http(easRpcUrl(net), { retryCount: 4, retryDelay: 400 });
  const wallet = createWalletClient({ account, chain: net.chain, transport });
  const reader = createPublicClient({ chain: net.chain, transport });

  const data = encodeReceipt(receiptData(report, process.env.PUBLIC_BASE_URL || "http://localhost:3000"));

  const txHash = await wallet.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: "attest",
    args: [
      {
        schema,
        data: {
          recipient: zeroAddress, // §11: no recipient
          expirationTime: 0n,
          revocable: SCHEMA_REVOCABLE,
          refUID: zeroHash,
          data,
          value: 0n,
        },
      },
    ],
  });

  const receipt = await reader.waitForTransactionReceipt({ hash: txHash, timeout: 45_000 });
  if (receipt.status !== "success") throw new Error(`attest transaction reverted: ${txHash}`);

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== EAS_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: EAS_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "Attested") return { uid: ev.args.uid, txHash, chain: net.id };
    } catch {
      /* not our event */
    }
  }
  throw new Error(`no Attested event in ${txHash}`);
}
