/**
 * spike-eas — OPEN QUESTION: can we read the EAS predeploy on Base with viem,
 * using only a public RPC and no wallet? (§11)
 *
 * Read-only. Writing attestations is Day 4 and needs ATTESTER_PRIVATE_KEY.
 */
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { save, h, expect, done } from "./_spike.js";

const EAS: Address = "0x4200000000000000000000000000000000000021";
const SCHEMA_REGISTRY: Address = "0x4200000000000000000000000000000000000020";

/** Minimal ABI — only what the receipt flow needs to read. */
const EAS_ABI = [
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
  { name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

async function main() {
  const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  h(`Base RPC: ${rpc}`);

  const client = createPublicClient({ chain: base, transport: http(rpc) });

  const blockNumber = await client.getBlockNumber();
  console.log(`  chainId ${base.id}, head block ${blockNumber}`);
  expect("public RPC responds", blockNumber > 0n);

  h("EAS + SchemaRegistry predeploys");
  const easCode = await client.getCode({ address: EAS });
  const registryCode = await client.getCode({ address: SCHEMA_REGISTRY });
  console.log(`  EAS            ${EAS}  code: ${easCode ? `${easCode.length} chars` : "NONE"}`);
  console.log(`  SchemaRegistry ${SCHEMA_REGISTRY}  code: ${registryCode ? `${registryCode.length} chars` : "NONE"}`);
  expect("EAS is deployed at the predeploy address", Boolean(easCode && easCode !== "0x"));
  expect("SchemaRegistry is deployed", Boolean(registryCode && registryCode !== "0x"));

  try {
    const version = await client.readContract({ address: EAS, abi: EAS_ABI, functionName: "version" });
    console.log(`  EAS version: ${version}`);
  } catch (e) {
    console.log(`  version() unavailable: ${String(e).slice(0, 80)}`);
  }

  h("Read a known attestation");
  // Any real Base attestation UID works here; this one is read-only and only proves
  // the decode path. If it ever 404s, pick a fresh UID from base.easscan.org.
  const uid = (process.env.SPIKE_ATTESTATION_UID ??
    "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`;

  try {
    const att = await client.readContract({
      address: EAS,
      abi: EAS_ABI,
      functionName: "getAttestation",
      args: [uid],
    });
    const empty = att.schema === "0x0000000000000000000000000000000000000000000000000000000000000000";
    console.log(`  uid       : ${uid}`);
    console.log(`  schema    : ${att.schema}`);
    console.log(`  attester  : ${att.attester}`);
    console.log(`  time      : ${att.time}`);
    console.log(`  revocable : ${att.revocable}`);
    console.log(
      empty
        ? `  (zero UID returns an empty record, as expected — set SPIKE_ATTESTATION_UID to decode a real one)`
        : `  decoded a real attestation`,
    );
    expect("getAttestation decodes without a wallet", true);
    save("eas", { rpc, blockNumber, uid, attestation: att });
  } catch (e) {
    console.log(`  getAttestation FAILED: ${String(e).slice(0, 140)}`);
    expect("getAttestation decodes without a wallet", false);
  }

  done(
    "EAS",
    "Readable, no wallet needed",
    `EAS ${EAS} and SchemaRegistry ${SCHEMA_REGISTRY} both have code on Base; getAttestation decodes via viem over the public RPC. Writing needs ATTESTER_PRIVATE_KEY (Day 4).`,
  );
}

main().catch((e) => {
  console.error("spike-eas failed:", e);
  process.exit(1);
});
