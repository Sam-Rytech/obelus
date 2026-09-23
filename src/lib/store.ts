/**
 * Report storage — architecture §5 step 6, §12.
 *
 * Reports live in Upstash under `report:<id>`, 90-day TTL. Without Redis configured
 * they live in process memory, which is enough for local development and useless on
 * serverless — production must set UPSTASH_REDIS_REST_URL/TOKEN.
 */
import { Redis } from "@upstash/redis";

import { Report } from "./schema";

const TTL_SECONDS = 60 * 60 * 24 * 90;
const memory = new Map<string, Report>();

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

/** Short, URL-safe, unguessable enough for a share link: 10 chars of base62. */
export function newReportId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function isReportId(id: string): boolean {
  return /^[0-9A-Za-z]{10}$/.test(id);
}

export async function saveReport(report: Report): Promise<void> {
  const valid = Report.parse(report); // never persist something the schema rejects
  const r = redis();
  if (r) {
    await r.set(`report:${valid.id}`, valid, { ex: TTL_SECONDS });
  } else {
    memory.set(valid.id, valid);
  }
}

export async function getReport(id: string): Promise<Report | null> {
  if (!isReportId(id)) return null;
  const r = redis();
  const raw = r ? await r.get<unknown>(`report:${id}`) : memory.get(id);
  if (!raw) return null;
  const parsed = Report.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
