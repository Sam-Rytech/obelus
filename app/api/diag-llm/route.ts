/**
 * TEMPORARY diagnostic — times Gemini from inside Vercel, where extraction times out
 * although the same request takes ~4 s from Lagos. Remove once diagnosed.
 * Requires the x-diag-secret header (TELEGRAM_WEBHOOK_SECRET) so it can't spend quota.
 */

import { SYSTEM_PROMPT } from "@/src/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API = "https://generativelanguage.googleapis.com/v1beta";

async function timed(label: string, fn: () => Promise<Response>) {
  const t0 = Date.now();
  try {
    const res = await fn();
    const body = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j.usageMetadata) detail += ` thoughts=${j.usageMetadata.thoughtsTokenCount ?? 0} out=${j.usageMetadata.candidatesTokenCount ?? "?"}`;
      if (j.error) detail += ` ${String(j.error.message).slice(0, 120)}`;
    } catch {
      /* not JSON */
    }
    return { label, ms: Date.now() - t0, detail };
  } catch (err) {
    return { label, ms: Date.now() - t0, detail: `ERR ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function GET(req: Request) {
  if (req.headers.get("x-diag-secret") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const key = process.env.GEMINI_API_KEY!;
  const headers = { "content-type": "application/json", "x-goog-api-key": key };
  const model = new URL(req.url).searchParams.get("model") ?? "gemini-3.6-flash";
  const text = "TEST ANNOUNCEMENT — Aerodrome Finance (AERO) is now listed on WEEX and BingX. Audited by CertiK.";

  const gen = (contents: string, extra: object = {}) =>
    fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: contents }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" }, ...extra },
      }),
      signal: AbortSignal.timeout(50_000),
    });

  const results = [];
  results.push(await timed("models.get", () => fetch(`${API}/models/${model}`, { headers, signal: AbortSignal.timeout(15_000) })));
  results.push(await timed("tiny generate", () => gen("Reply with OK.")));
  results.push(
    await timed("extraction", () =>
      fetch(`${API}/models/${model}:generateContent`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: `<<<ANNOUNCEMENT>>>\n${text}\n<<<END_ANNOUNCEMENT>>>` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
        }),
        signal: AbortSignal.timeout(50_000),
      }),
    ),
  );
  return Response.json({ region: process.env.VERCEL_REGION ?? "?", model, results });
}
