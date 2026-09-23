/**
 * Rate limiting — architecture §12: 10 checks per IP per hour.
 *
 * Each check spends real money (one LLM call) and scarce credits (Tavily), so the
 * public endpoint must be limited. Without Redis there is nothing shared to count
 * against, so local development is unlimited.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let limiter: Ratelimit | null | undefined;

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  limiter =
    url && token
      ? new Ratelimit({
          redis: new Redis({ url, token }),
          limiter: Ratelimit.slidingWindow(10, "1 h"),
          prefix: "obelus:ratelimit",
        })
      : null;
  return limiter;
}

export type RateResult = { ok: boolean; remaining: number; resetAt: number };

export async function checkRate(ip: string): Promise<RateResult> {
  const l = getLimiter();
  if (!l) return { ok: true, remaining: Infinity, resetAt: 0 };
  try {
    const r = await l.limit(ip);
    return { ok: r.success, remaining: r.remaining, resetAt: r.reset };
  } catch {
    // A Redis outage must not take the product down with it.
    return { ok: true, remaining: 0, resetAt: 0 };
  }
}

/** Vercel sets x-forwarded-for; the first entry is the client. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
