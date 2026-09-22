/**
 * spike-lockers — establish the Base locker addresses for §10.4, and prove each one
 * is a real deployed contract before it is allowed into the registry.
 *
 * RULE (architecture §9): addresses come from official docs ONLY, never from memory,
 * and each is stored next to the docs URL it came from. A wrong locker address turns
 * a real lock into a false ❌, which is the worst failure this product can have.
 *
 * Status Sep 22 — the docs could NOT simply be trusted:
 *  - UNCX lists three Base v2 lockers. Only TWO are deployed on Base. The
 *    "Base (Uniswap V2)" row, 0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB, has NO CODE
 *    on Base. Had it gone into the registry unverified, balanceOf would have returned 0
 *    forever and every genuinely Uniswap-V2-locked project would have been stamped as
 *    not locked. Only the two confirmed lockers are registered.
 *  - Every Base row in those docs links to the same explorer address
 *    (0x231278edd38b00b07fbd52120cef685b9baebcc1), which IS deployed on Base but is not
 *    labelled in the address column. Unconfirmed, so it is NOT registered: admitting a
 *    non-locker as a locker would manufacture a false ✅, the worst failure mode here.
 *  - Team Finance: BLOCKED. docs.team.finance does not resolve, and no other official
 *    team.finance page publishes the Base locker address. Not guessed. See Progress.md.
 */
import { createPublicClient, http, getAddress, type Address } from "viem";
import { base } from "viem/chains";
import { save, h, expect, done } from "./_spike.js";

const UNCX_DOCS =
  "https://docs.uncx.network/guides/for-developers/liquidity-lockers/lockers-v2/contracts";

/** v2-style (ERC-20 LP) lockers only — §10.4 does not support v3/v4 NFT locks. */
const LOCKERS = [
  {
    id: "uncx-sushi",
    name: "UNCX — Sushiswap (Base)",
    address: "0xBeddF48499788607B4c2e704e9099561ab38Aae8",
    lpType: "v2",
    source: UNCX_DOCS,
  },
  {
    id: "uncx-aerodrome",
    name: "UNCX — Aerodrome (Base)",
    address: "0x30e522deDfFE3e3d11Cd53E27d18Cd4F016eD870",
    lpType: "v2",
    source: UNCX_DOCS,
  },
] as const;

/**
 * Published in the official docs but NOT admitted to the registry. Each is re-checked
 * on every run so the reason stays current, and so a docs fix is noticed.
 */
const REJECTED = [
  {
    id: "uncx-univ2",
    address: "0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB",
    reason: 'listed by UNCX as "Base (Uniswap V2)" but no contract is deployed at it on Base',
    expectCode: false,
  },
  {
    id: "uncx-base-link-target",
    address: "0x231278edd38b00b07fbd52120cef685b9baebcc1",
    reason: "the address every Base row's explorer link points to; deployed on Base, but never labelled in the docs, so its role is unconfirmed",
    expectCode: true,
  },
] as const;

/** Burn addresses count toward "burned%", tracked separately from "locked%" (§10.4). */
const BURN_ADDRESSES = [
  "0x000000000000000000000000000000000000dEaD",
  "0x0000000000000000000000000000000000000000",
] as const;

const ERC20_ABI = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Top Aerodrome AERO/USDC pair on Base — a real v2-style ERC-20 LP to read against. */
const SAMPLE_LP: Address = "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d";

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });

  h("Checksum + on-chain existence of every locker address");
  const verified: Record<string, unknown>[] = [];

  for (const l of LOCKERS) {
    let checksummed: string;
    try {
      checksummed = getAddress(l.address); // throws on a bad checksum = typo guard
    } catch {
      expect(`${l.id} address is a valid checksummed address`, false, l.address);
      continue;
    }

    const code = await client.getCode({ address: checksummed as Address });
    const hasCode = Boolean(code && code !== "0x");
    console.log(`  ${l.id.padEnd(16)} ${checksummed}  code: ${hasCode ? `${code!.length} chars` : "NONE"}`);
    expect(`${l.id} is a deployed contract on Base`, hasCode, l.name);

    verified.push({ ...l, address: checksummed, hasCode, codeSize: code?.length ?? 0 });
  }

  h("Addresses published in the docs but REJECTED from the registry");
  for (const r of REJECTED) {
    const code = await client.getCode({ address: getAddress(r.address) as Address });
    const hasCode = Boolean(code && code !== "0x");
    console.log(`  ${r.id.padEnd(24)} ${r.address}  code: ${hasCode ? `${code!.length} chars` : "NONE"}`);
    console.log(`    rejected: ${r.reason}`);
    expect(
      `${r.id} still ${r.expectCode ? "has" : "has no"} code (docs unchanged)`,
      hasCode === r.expectCode,
      hasCode === r.expectCode ? "" : "UNCX may have fixed or changed their docs — re-check the table",
    );
  }

  h("Reading an LP the way §10.4 will");
  const totalSupply = await client.readContract({
    address: SAMPLE_LP,
    abi: ERC20_ABI,
    functionName: "totalSupply",
  });
  console.log(`  sample LP ${SAMPLE_LP}`);
  console.log(`  totalSupply: ${totalSupply}`);
  expect("sample LP is a v2-style ERC-20 with totalSupply", totalSupply > 0n);

  let lockedSum = 0n;
  for (const l of verified) {
    const bal = await client.readContract({
      address: SAMPLE_LP,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [l.address as Address],
    });
    lockedSum += bal;
    const pct = totalSupply > 0n ? Number((bal * 10000n) / totalSupply) / 100 : 0;
    console.log(`  balanceOf(${String(l.id).padEnd(16)}) = ${bal}  (${pct.toFixed(4)}%)`);
  }

  let burnedSum = 0n;
  for (const addr of BURN_ADDRESSES) {
    const bal = await client.readContract({
      address: SAMPLE_LP,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [getAddress(addr) as Address],
    });
    burnedSum += bal;
    console.log(`  balanceOf(${addr.slice(0, 10)}...burn) = ${bal}`);
  }

  const lockedPct = totalSupply > 0n ? Number((lockedSum * 10000n) / totalSupply) / 100 : 0;
  const burnedPct = totalSupply > 0n ? Number((burnedSum * 10000n) / totalSupply) / 100 : 0;
  console.log(`\n  locked: ${lockedPct.toFixed(4)}%   burned: ${burnedPct.toFixed(4)}%`);
  console.log(`  (AERO/USDC is a live trading pair, not a locked launch — 0% locked is the expected result;`);
  console.log(`   what this proves is that the balanceOf path works against a real Base LP.)`);
  expect("balanceOf against a real Base LP returns without error", true);

  save("lockers", { verified, rejected: REJECTED, sampleLp: SAMPLE_LP, totalSupply, lockedSum, burnedSum });

  h("Team Finance — BLOCKED, not guessed");
  console.log("  docs.team.finance does not resolve; no other official team.finance page");
  console.log("  publishes the Base locker address. Per §9 it must come from official docs,");
  console.log("  so it is NOT in the registry. Until resolved, a Team-Finance-locked LP");
  console.log("  returns UNVERIFIED LP_NOT_IN_KNOWN_LOCKER — which is correct, not a false ❌.");

  done(
    "Lockers (Base)",
    `${verified.filter((v) => v.hasCode).length} registered, 2 rejected; Team Finance BLOCKED`,
    `From ${UNCX_DOCS}. Registered (docs-listed AND deployed on Base): Sushiswap \`${LOCKERS[0].address}\`, Aerodrome \`${LOCKERS[1].address}\`. **Rejected: UNCX's "Base (Uniswap V2)" row \`0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB\` has NO CODE on Base** — registering it unverified would have made every Uniswap-V2-locked project look unlocked. Also rejected: \`0x231278edd38b00b07fbd52120cef685b9baebcc1\` (target of every Base explorer link, deployed but unlabelled). Team Finance: docs domain unreachable, address NOT guessed — see Blockers.`,
  );
}

main().catch((e) => {
  console.error("spike-lockers failed:", e);
  process.exit(1);
});
