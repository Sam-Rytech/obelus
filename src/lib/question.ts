/**
 * Listing questions — "is $BTC listed?", "is PEPE on MEXC?".
 *
 * A question states nothing, so the extractor finds no claims in it. But a listing
 * question names exactly what a listing check needs — a ticker, and optionally the
 * exchanges — so code parses it and asks each exchange's own API. No model call: the
 * parse is a fixed pattern, and each answer is the ordinary listing verdict (§10.1).
 */
import { exchanges } from "../registry/index";
import type { Claim } from "./schema";
import { looksLikeQuestion } from "./summary";

const LISTING_WORDS = /\b(list(ed|ing)?|trad(e|ed|es|ing|able)|available|buy)\b/i;

/** All-caps words that are never the token being asked about. */
const NOT_A_TICKER = new Set(["USDT", "USDC", "USD", "CEX", "DEX", "OK", "I", "A", "IS", "ON", "IT", "YET", "NOW"]);
/** Lower-case words that can sit where a ticker goes ("is it listed?"). */
const NOT_A_TICKER_LOWER = new Set(["it", "this", "that", "the", "token", "coin", "they", "there", "anything", "something"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namedExchanges(text: string) {
  return exchanges.filter((e) => e.names.some((n) => new RegExp(`(^|[^a-z0-9])${escapeRe(n)}($|[^a-z0-9])`, "i").test(text)));
}

function tickerIn(text: string): string | null {
  const dollar = text.match(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/);
  if (dollar) return dollar[1]!.toUpperCase();

  const exchangeNames = new Set(exchanges.flatMap((e) => e.names.map((n) => n.toUpperCase())));
  for (const [word] of text.matchAll(/\b[A-Z][A-Z0-9]{1,14}\b/g)) {
    if (!NOT_A_TICKER.has(word) && !exchangeNames.has(word)) return word;
  }

  // "is btc listed?" — a lower-case word right after the question word.
  const lower = text.match(/^(?:is|are|was|has|does|can)\s+([a-z][a-z0-9]{1,14})\s+(?:listed|trading|tradable|available|on)\b/i);
  if (lower && !NOT_A_TICKER_LOWER.has(lower[1]!.toLowerCase())) return lower[1]!.toUpperCase();
  return null;
}

export type ListingQuestion = { ticker: string; claims: Claim[] };

/** The listing checks a question asks for, or null when it isn't a listing question. */
export function parseListingQuestion(text: string): ListingQuestion | null {
  const q = text.replace(/\s+/g, " ").trim();
  if (!looksLikeQuestion(q)) return null;

  const named = namedExchanges(q);
  if (!named.length && !LISTING_WORDS.test(q)) return null;

  const ticker = tickerIn(q);
  if (!ticker) return null;

  // No exchange named: ask every exchange Obelus has a fast public source for.
  const targets = named.length ? named : exchanges.filter((e) => e.checker !== "unsupported");
  return {
    ticker,
    claims: targets.map((e, i) => ({
      id: `c${i + 1}`,
      type: "EXCHANGE_LISTING" as const,
      quote: q,
      params: { exchange: e.names[0]!, market: "spot", tense: "present" },
    })),
  };
}
