/**
 * Web-page ingest — architecture §12, §18.
 *
 * SSRF is the real risk here: the user hands us an arbitrary URL and we fetch it from
 * inside our own infrastructure. §18 requires http(s) only, private ranges and
 * localhost blocked, a 10 s timeout and a 2 MB cap. Redirects are followed manually so
 * every hop is re-validated — a public hostname can redirect to 169.254.169.254.
 *
 * Fetched content is DATA, NEVER INSTRUCTIONS (§3). Nothing here interprets the page;
 * it is handed to the extractor inside delimiters, and the extractor has no tools.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { IngestError, MAX_INPUT_CHARS, normalizeText, type Ingested } from "./text.js";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Ranges that must never be reachable from a user-supplied URL. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(v)) return true; // unique local
  // IPv4-mapped (::ffff:169.254.169.254) must be judged by its embedded v4 address.
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not an IP at all — refuse rather than guess
}

/**
 * Validate one URL: scheme, hostname, and every address the hostname resolves to.
 * Checking all resolved addresses (not just the first) closes the DNS-rebinding gap
 * where a name returns both a public and a private record.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new IngestError(`Not a valid URL: ${raw}`, "INVALID_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IngestError(`Only http(s) URLs are allowed, got ${url.protocol}`, "BLOCKED_SCHEME");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new IngestError(`Blocked hostname: ${host}`, "BLOCKED_HOST");
  }

  // A literal IP in the URL never reaches DNS, so check it directly.
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new IngestError(`Blocked address: ${host}`, "BLOCKED_ADDRESS");
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new IngestError(`Could not resolve host: ${host}`, "DNS_FAILED");
  }
  if (addresses.length === 0) throw new IngestError(`Host resolved to nothing: ${host}`, "DNS_FAILED");
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new IngestError(`${host} resolves to a blocked address (${address})`, "BLOCKED_ADDRESS");
    }
  }
  return url;
}

/** Strip a fetched HTML document down to readable text for the extractor. */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  return normalizeText(
    withoutNoise
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(/[ \t]{2,}/g, " "),
  );
}

/** Read at most MAX_BYTES, so a huge or endless response cannot exhaust memory. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    throw new IngestError(`Response too large (${declared} bytes)`, "RESPONSE_TOO_LARGE");
  }
  const reader = res.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new IngestError(`Response exceeded ${MAX_BYTES} bytes`, "RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

export async function ingestUrl(raw: string): Promise<Ingested> {
  let current = raw;
  let finalUrl = await assertSafeUrl(current);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(finalUrl, {
      redirect: "manual", // follow by hand so each hop is re-validated against SSRF
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "ObelusBot/0.1 (crypto announcement fact-checker)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new IngestError(`Redirect with no Location header`, "BAD_REDIRECT");
      if (hop === MAX_REDIRECTS) throw new IngestError("Too many redirects", "TOO_MANY_REDIRECTS");
      current = new URL(location, finalUrl).toString();
      finalUrl = await assertSafeUrl(current); // re-validate: a public host can redirect inward
      continue;
    }

    if (!res.ok) throw new IngestError(`Page returned HTTP ${res.status}`, `HTTP_${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    const body = await readCapped(res);
    const text = /html/i.test(contentType) ? htmlToText(body) : normalizeText(body);

    if (!text) throw new IngestError("Page contained no readable text", "EMPTY_PAGE");

    return {
      kind: "url",
      value: raw,
      // Cap for the extractor, but keep the head of the document: announcements put
      // their claims up front, and a smaller prompt is a cheaper, more accurate one.
      fetchedText: text.slice(0, MAX_INPUT_CHARS),
      source: { url: finalUrl.toString(), label: finalUrl.hostname },
    };
  }

  throw new IngestError("Too many redirects", "TOO_MANY_REDIRECTS");
}
