/**
 * Text matching shared by the search-based checkers (§10.2, §10.5).
 *
 * The rule in both is "the page contains the project name (exact, case-insensitive)".
 * "Exact" means a whole-word match: a project called "Nova" must not match
 * "Supernova", or a short name would verify against almost any page.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive; internal whitespace in the name matches any run of it. */
export function nameRegex(name: string): RegExp | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null; // a one-letter name matches everything
  const pattern = trimmed.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "i");
}

export function mentionsName(text: string, name: string): boolean {
  const re = nameRegex(name);
  return re ? re.test(text) : false;
}

/**
 * Split into sentences for "same passage" rules. Newlines count as boundaries,
 * because scraped pages run headings and table cells together without punctuation.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize a name to compare against slugs: lowercase alphanumerics only. */
export function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
