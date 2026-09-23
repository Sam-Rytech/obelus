/**
 * Anchor a stored report on Base, then write the receipt back onto it — architecture §5
 * step 6. Called after the user already has their report link, so it never blocks them.
 *
 * The receipt is added to the stored report without touching anything that is hashed:
 * `attestation` is excluded from reportHash by design (§11).
 */
import { attestReport, easConfigured } from "./eas";
import type { Report } from "./schema";
import { getReport, saveReport } from "./store";

export async function anchorReport(report: Report): Promise<Report["attestation"] | null> {
  if (!easConfigured()) return null;
  try {
    const receipt = await attestReport(report);
    if (!receipt) return null;
    // Re-read so a concurrent write isn't clobbered, then add only the receipt.
    const current = (await getReport(report.id)) ?? report;
    await saveReport({ ...current, attestation: receipt });
    return receipt;
  } catch (err) {
    // No gas, RPC down, reverted: the report stands and shows "receipt pending".
    console.error(`[anchor] report ${report.id} not attested:`, err instanceof Error ? err.message : err);
    return null;
  }
}
