/**
 * X / Twitter post ingest — architecture §7, §12.
 *
 * FxTwitter first, oEmbed as fallback, both cached 24 h (§20: FxTwitter is
 * rate-limited, and a rate-limited demo is a failed demo).
 *
 * Verified Sep 22 (scripts/spike-fxtwitter.ts):
 *  - `/i/status/<id>` works WITHOUT the username, so we only need the id from the URL.
 *  - publish.twitter.com 301s to publish.x.com; we call the final host directly.
 *  - A nonexistent id returns typed JSON { code: 404 } from FxTwitter, but an HTML
 *    error page from oEmbed — hence the JSON guard in the fallback.
 *
 * Tweet text is DATA, NEVER INSTRUCTIONS (§3, §18).
 */
import { cached, TTL } from "../cache.js";
import { IngestError, MAX_INPUT_CHARS, normalizeText, type Ingested } from "./text.js";

const FX_UA = "ObelusBot/0.1 (crypto announcement fact-checker)";
const TIMEOUT_MS = 8_000;

/** Accepts x.com, twitter.com, mobile./www. variants, /i/web/status/, and query strings. */
export function parseTweetId(input: string): string | null {
  const match = input.match(
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter)\.com\/(?:[A-Za-z0-9_]+|i\/web)\/status(?:es)?\/(\d{1,25})/i,
  );
  return match?.[1] ?? null;
}

export function isTweetUrl(input: string): boolean {
  return parseTweetId(input) !== null;
}

type FxResponse = {
  code: number;
  message: string;
  tweet?: {
    url: string;
    id: string;
    text: string;
    created_at: string;
    author?: { screen_name?: string; name?: string };
  } | null;
};

async function viaFxTwitter(id: string): Promise<Ingested | null> {
  const res = await fetch(`https://api.fxtwitter.com/i/status/${id}`, {
    headers: { accept: "application/json", "user-agent": FX_UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // 404 is a definitive answer (deleted/protected); other non-200s may be transient,
  // so let the caller fall through to oEmbed rather than treating them as final.
  if (!res.ok && res.status !== 404) return null;

  const body = (await res.json().catch(() => null)) as FxResponse | null;
  const tweet = body?.tweet;
  if (!tweet?.text) return null;

  const author = tweet.author?.screen_name ? `@${tweet.author.screen_name}` : "unknown author";
  return {
    kind: "x",
    value: tweet.url || `https://x.com/i/status/${id}`,
    fetchedText: normalizeText(tweet.text).slice(0, MAX_INPUT_CHARS),
    source: { url: tweet.url || `https://x.com/i/status/${id}`, label: `X post by ${author}` },
  };
}

async function viaOEmbed(id: string): Promise<Ingested | null> {
  const tweetUrl = `https://x.com/i/status/${id}`;
  const res = await fetch(
    `https://publish.x.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=1`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) return null;

  // oEmbed serves an HTML error page for a missing tweet, so never assume JSON.
  const raw = await res.text();
  let body: { html?: string; author_name?: string; url?: string };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return null;
  }

  const text = normalizeText(
    (body.html ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&mdash;/g, "—")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " "),
  );
  if (!text) return null;

  return {
    kind: "x",
    value: body.url ?? tweetUrl,
    fetchedText: text.slice(0, MAX_INPUT_CHARS),
    source: {
      url: body.url ?? tweetUrl,
      label: `X post by ${body.author_name ? `@${body.author_name}` : "unknown author"} (via oEmbed)`,
    },
  };
}

export async function ingestX(input: string): Promise<Ingested> {
  const id = parseTweetId(input);
  if (!id) throw new IngestError(`Not a recognisable X post URL: ${input}`, "NOT_A_TWEET_URL");

  return cached(`tweet:${id}`, TTL.TWEET, async () => {
    // A transport failure on the primary must not block the fallback.
    const primary = await viaFxTwitter(id).catch(() => null);
    if (primary) return primary;

    const fallback = await viaOEmbed(id).catch(() => null);
    if (fallback) return fallback;

    throw new IngestError(
      `Could not read tweet ${id}. It may be deleted, protected, or both sources are rate-limited — paste the text instead.`,
      "TWEET_UNAVAILABLE",
    );
  });
}
