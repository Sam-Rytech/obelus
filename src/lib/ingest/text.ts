/**
 * Pasted-text ingest — architecture §12.
 *
 * The simplest path, and the one that always works when FxTwitter is rate-limited or
 * a page blocks us (§20). Input is capped at 8,000 characters.
 */

export const MAX_INPUT_CHARS = 8_000;

export type Ingested = {
  kind: "x" | "url" | "text";
  value: string;
  /** The text claims are extracted from. The quote guard checks against exactly this. */
  fetchedText: string;
  source?: { url: string; label: string };
};

export class IngestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/**
 * Normalize whitespace without changing character offsets in a way that would break
 * the quote guard: the model quotes from `fetchedText`, so whatever we return here is
 * the single source of truth for what counts as a valid quote.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ") // non-breaking spaces defeat exact-substring matching
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ingestText(input: string): Ingested {
  const text = normalizeText(input);
  if (!text) throw new IngestError("Input is empty", "EMPTY_INPUT");
  if (text.length > MAX_INPUT_CHARS) {
    throw new IngestError(`Input exceeds ${MAX_INPUT_CHARS} characters`, "INPUT_TOO_LONG");
  }
  return { kind: "text", value: input, fetchedText: text };
}
