/**
 * Attest an already-stored report on Base and write the receipt onto it.
 *
 *   pnpm spike scripts/attest-report.ts <reportId>
 *
 * The same path /api/check uses after every check (src/lib/anchor.ts), runnable by hand:
 * to test receipts end to end, and to re-attest the pinned demo reports on mainnet when
 * EAS_CHAIN switches from Base Sepolia to Base.
 */
import { attestReport } from "../src/lib/eas";
import { easChainById } from "../src/lib/chains";
import { getReport, saveReport } from "../src/lib/store";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: pnpm spike scripts/attest-report.ts <reportId>");

  const report = await getReport(id);
  if (!report) throw new Error(`no stored report ${id}`);

  console.log(`report ${id}: ${report.project.name ?? "?"}, hash ${report.reportHash}`);
  if (report.attestation) {
    console.log(`(replacing existing receipt on ${easChainById(report.attestation.chain).label})`);
  }

  const receipt = await attestReport(report);
  if (!receipt) throw new Error("EAS is not configured (ATTESTER_PRIVATE_KEY / EAS_SCHEMA_UID)");

  await saveReport({ ...report, attestation: receipt });
  const net = easChainById(receipt.chain);
  console.log(`network : ${net.label}`);
  console.log(`tx      : ${net.explorer}/tx/${receipt.txHash}`);
  console.log(`receipt : ${net.easscan}/attestation/view/${receipt.uid}`);
  console.log(`verify  : ${process.env.PUBLIC_BASE_URL}/r/${id}/verify`);
}

main().catch((e) => {
  console.error("attest-report failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
