/**
 * Domain-restricted search — architecture §6, §10.2, §10.5.
 *
 * Tavily's only jobs: the PARTNERSHIP check and the CertiK slug fallback. Verified
 * Sep 23 (scripts/spike-tavily.ts) that `includeDomains` is a hard restriction —
 * which matters, because a result on a partner's domain is treated as that partner
 * speaking. Also verified: Tavily returns results even for a project that does not
 * exist, so callers must match names in content and never trust result count.
 *
 * Cached 24 h (§12) to stay inside the 1,000-credit monthly free tier.
 */
import { tavily } from "@tavily/core";

import { cached, TTL } from "./cache";

export type SearchResult = {
  url: string;
  title: string;
  content: string;
  /** Full page text when available; the snippet alone often omits the key sentence. */
  rawContent?: string;
};

export interface Searcher {
  search(query: string, domains: string[]): Promise<SearchResult[]>;
}

/**
 * Measured 6–11 s per search from Lagos, over §18's 8 s per-call ceiling. Checks run
 * in parallel, so a 12 s search still fits the 60 s pipeline; logged as a deviation.
 */
export const SEARCH_TIMEOUT_MS = 12_000;

/** A result is on-domain if its host is the domain itself or a subdomain of it. */
export function isOnDomain(url: string, domains: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => {
    const dom = d.toLowerCase();
    return host === dom || host.endsWith(`.${dom}`);
  });
}

class TavilySearcher implements Searcher {
  private readonly client: ReturnType<typeof tavily>;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(query: string, domains: string[]): Promise<SearchResult[]> {
    const key = `tavily:${query}:${[...domains].sort().join(",")}`;
    return cached(key, TTL.TAVILY, async () => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`search timed out after ${SEARCH_TIMEOUT_MS}ms`)), SEARCH_TIMEOUT_MS),
      );
      const res = await Promise.race([
        this.client.search(query, {
          includeDomains: domains,
          maxResults: 5,
          searchDepth: "basic",
          includeRawContent: "text",
        }),
        timeout,
      ]);

      return (res.results ?? [])
        // Belt and braces: include_domains is verified to be hard, but a result that
        // is not on a listed domain must never reach a verdict regardless.
        .filter((r) => isOnDomain(r.url, domains))
        .map((r) => ({
          url: r.url,
          title: r.title ?? "",
          content: r.content ?? "",
          // Raw page text can be very large; the checkers only need the head of it.
          rawContent: r.rawContent ? r.rawContent.slice(0, 20_000) : undefined,
        }));
    });
  }
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("TAVILY_API_KEY is not set");
    this.name = "SearchNotConfiguredError";
  }
}

let shared: Searcher | undefined;

export function createSearcher(): Searcher {
  if (shared) return shared;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new SearchNotConfiguredError();
  shared = new TavilySearcher(apiKey);
  return shared;
}
