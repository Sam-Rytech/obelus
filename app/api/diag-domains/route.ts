/**
 * TEMPORARY — verify registry domains from production's network (the dev network's ISP
 * intermittently blocks crypto domains). Requires the operator token. Remove after use.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.ADMIN_TOKEN || req.headers.get("x-obelus-admin") !== process.env.ADMIN_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  const domains = (new URL(req.url).searchParams.get("d") ?? "").split(",").filter(Boolean).slice(0, 40);
  const results = await Promise.all(
    domains.map(async (d) => {
      try {
        const res = await fetch(`https://${d}/`, {
          redirect: "follow",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" },
          signal: AbortSignal.timeout(12_000),
        });
        return { domain: d, status: res.status, finalHost: new URL(res.url).hostname };
      } catch (err) {
        return { domain: d, status: "ERR", finalHost: err instanceof Error ? err.message.slice(0, 60) : "error" };
      }
    }),
  );
  return Response.json({ region: process.env.VERCEL_REGION ?? "?", results });
}
