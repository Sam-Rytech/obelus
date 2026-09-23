/**
 * Input detection — architecture §12.
 *
 * `x.com|twitter.com/.../status/<id>` → X; other `http(s)://` → URL; else text.
 */
import { ingestText, IngestError, type Ingested } from "./text";
import { ingestUrl } from "./url";
import { ingestX, isTweetUrl } from "./x";

export { IngestError, MAX_INPUT_CHARS, normalizeText } from "./text";
export type { Ingested } from "./text";
export { assertSafeUrl, htmlToText, isBlockedAddress } from "./url";
export { isTweetUrl, parseTweetId } from "./x";

export type InputKind = "x" | "url" | "text";

export function detectKind(input: string): InputKind {
  const trimmed = input.trim();
  if (isTweetUrl(trimmed)) return "x";
  // Only treat it as a URL when the whole input is one — pasted announcements often
  // contain links, and those should be extracted from as text, not fetched.
  if (/^https?:\/\/\S+$/i.test(trimmed)) return "url";
  return "text";
}

export async function ingest(input: string): Promise<Ingested> {
  const trimmed = input.trim();
  if (!trimmed) throw new IngestError("Input is empty", "EMPTY_INPUT");

  switch (detectKind(trimmed)) {
    case "x":
      return ingestX(trimmed);
    case "url":
      return ingestUrl(trimmed);
    default:
      return ingestText(input);
  }
}
