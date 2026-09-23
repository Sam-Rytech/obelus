/**
 * GET /api/report/[id] — architecture §12.
 *
 * The full report JSON, for agents calling Obelus and for the verify page, which
 * recomputes reportHash from exactly this payload.
 */
import { getReport, isReportId } from "@/src/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isReportId(id)) {
    return Response.json({ code: "BAD_ID", message: "Not a valid report id." }, { status: 400 });
  }

  let report;
  try {
    report = await getReport(id);
  } catch (err) {
    // Storage unreachable is NOT "no such report" — answering 404 here would tell a
    // caller a real report doesn't exist. Same rule as the checkers: an unreachable
    // source is not an answer.
    console.error("[api/report]", err);
    return Response.json(
      { code: "STORAGE_UNAVAILABLE", message: "Report storage is temporarily unreachable. Try again shortly." },
      { status: 503, headers: { "retry-after": "10" } },
    );
  }
  if (!report) {
    return Response.json({ code: "NOT_FOUND", message: "No report with that id." }, { status: 404 });
  }

  return Response.json(report, {
    headers: {
      // The report body is fixed once written; only its attestation is added later
      // (Day 4), so a short shared cache is safe.
      "cache-control": "public, max-age=0, s-maxage=60",
      "access-control-allow-origin": "*", // agents may call this cross-origin (§4)
    },
  });
}
