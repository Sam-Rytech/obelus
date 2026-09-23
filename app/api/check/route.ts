/**
 * POST /api/check — architecture §12.
 *
 * Body: { input: string }. Streams Server-Sent Events while the pipeline runs:
 *   event: trace   data: { t, step }                    — one per decision (§5)
 *   event: done    data: { reportId, counts }           — report stored, fetch it
 *   event: error   data: { code, message }              — nothing was stored
 *
 * Rate-limited to 10 checks per IP per hour: each check costs a model call and
 * search credits.
 */
import { after } from "next/server";

import { anchorReport } from "@/src/lib/anchor";
import { PipelineError, runPipeline } from "@/src/lib/pipeline";
import { checkRate, clientIp } from "@/src/lib/ratelimit";
import type { Report } from "@/src/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // §18: Vercel limit; the pipeline is budgeted to fit

/** Hard cap before any work — ingest enforces 8,000 chars of text itself. */
const MAX_BODY_CHARS = 20_000;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Errors a user can act on are shown as-is; anything internal becomes generic. */
function publicError(err: unknown): { code: string; message: string } {
  if (err instanceof PipelineError) {
    if (err.code.startsWith("INGEST_")) return { code: err.code, message: err.message };
    if (err.code === "LLM_NOT_CONFIGURED" || err.code === "EXTRACTION_FAILED") {
      return { code: err.code, message: "The claim extractor is unavailable right now. Please try again shortly." };
    }
    return { code: err.code, message: "Obelus could not complete this check." };
  }
  return { code: "INTERNAL", message: "Obelus could not complete this check." };
}

export async function POST(req: Request) {
  const rate = await checkRate(clientIp(req.headers));
  if (!rate.ok) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return json(
      429,
      { code: "RATE_LIMITED", message: "Limit reached: 10 checks per hour. Please try again later." },
      { "retry-after": String(retryAfter) },
    );
  }

  const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) return json(400, { code: "EMPTY_INPUT", message: "Send { input: string } — a URL, an X post link, or announcement text." });
  if (input.length > MAX_BODY_CHARS) return json(413, { code: "INPUT_TOO_LONG", message: "Input is too long." });

  // Receipt on Base (§11) AFTER the response: the user gets their link without waiting on
  // gas, and after() keeps the serverless function alive until the attestation lands.
  let settle: (r: Report | null) => void = () => {};
  const finished = new Promise<Report | null>((resolve) => (settle = resolve));
  after(async () => {
    const report = await finished;
    if (report) await anchorReport(report);
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away; keep running so the report still gets stored
        }
      };

      try {
        const report = await runPipeline(input, { onTrace: (e) => send("trace", e) });
        const counts = {
          verified: report.results.filter((r) => r.verdict === "VERIFIED").length,
          contradicted: report.results.filter((r) => r.verdict === "CONTRADICTED").length,
          unverified: report.results.filter((r) => r.verdict === "UNVERIFIED").length,
        };
        send("done", { reportId: report.id, counts });
        settle(report);
      } catch (err) {
        console.error("[api/check]", err);
        send("error", publicError(err));
        settle(null);
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // stop proxies from buffering the stream
    },
  });
}
