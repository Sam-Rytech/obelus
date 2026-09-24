/**
 * Lay a report's claims back onto the announcement text, for the annotated report view.
 *
 * Every claim quote is a substring of `input.fetchedText` — the quote guard
 * (src/lib/extract.ts) forgives only whitespace — so each claim can be highlighted in
 * place. Web pages arrive with navigation clutter ("Home", "Pricing", "Log in"…), so long
 * stretches with no claims in them are folded, one click away rather than on screen.
 *
 * Pure and display-only: nothing here touches verdicts or the report hash.
 */

export type Range = { start: number; end: number };
export type Run = { text: string; claimIds: string[] };
export type Paragraph = {
  index: number;
  runs: Run[];
  /** Claims whose quote starts in this paragraph — their mark goes in this margin. */
  starts: string[];
  length: number;
};
export type Block = { kind: "para"; para: Paragraph } | { kind: "fold"; paras: Paragraph[] };
export type Annotated = { blocks: Block[]; unlocated: string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact match first; otherwise any whitespace in the quote matches any whitespace run. */
export function locateQuote(text: string, quote: string): Range | null {
  const q = quote.trim();
  if (!q) return null;
  const i = text.indexOf(q);
  if (i !== -1) return { start: i, end: i + q.length };
  const m = new RegExp(q.split(/\s+/).map(escapeRe).join("\\s+")).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Paragraph spans: separated by a blank line, trimmed, empty ones dropped. */
function paragraphSpans(text: string): Range[] {
  const spans: Range[] = [];
  const sep = /\n[ \t]*\n\s*/g;
  let from = 0;
  for (let m = sep.exec(text); ; m = sep.exec(text)) {
    const to = m ? m.index : text.length;
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (body) spans.push({ start: from + lead, end: from + lead + body.length });
    if (!m) break;
    from = m.index + m[0].length;
  }
  return spans;
}

/** A claim-free paragraph right next to a claim is kept as context, unless it is a stub. */
const CONTEXT_MIN_CHARS = 60;
/** Fold a claim-free stretch only when it is worth a control: 3+ paragraphs or 400+ chars. */
const FOLD_MIN_PARAS = 3;
const FOLD_MIN_CHARS = 400;

export function annotate(text: string, claims: { id: string; quote: string }[]): Annotated {
  const ranges: (Range & { id: string })[] = [];
  const unlocated: string[] = [];
  for (const c of claims) {
    const r = locateQuote(text, c.quote);
    if (r) ranges.push({ ...r, id: c.id });
    else unlocated.push(c.id);
  }

  const paras: Paragraph[] = paragraphSpans(text).map((p, index) => {
    const inside = ranges.filter((r) => r.start < p.end && r.end > p.start);
    const cuts = new Set([p.start, p.end]);
    for (const r of inside) {
      cuts.add(Math.max(r.start, p.start));
      cuts.add(Math.min(r.end, p.end));
    }
    const points = [...cuts].sort((a, b) => a - b);
    const runs: Run[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      if (a === b) continue;
      const claimIds = inside.filter((r) => r.start <= a && r.end >= b).map((r) => r.id);
      const last = runs.at(-1);
      // Merge neighbours with the same claims, so a highlight is one element.
      if (last && last.claimIds.join() === claimIds.join()) last.text += text.slice(a, b);
      else runs.push({ text: text.slice(a, b), claimIds });
    }
    const starts = inside.filter((r) => r.start >= p.start && r.start < p.end).map((r) => r.id);
    return { index, runs, starts, length: p.end - p.start };
  });

  const hasClaim = (p: Paragraph) => p.runs.some((r) => r.claimIds.length > 0);
  const keep = paras.map((p, i) => {
    if (hasClaim(p)) return true;
    const nearClaim = (paras[i - 1] && hasClaim(paras[i - 1]!)) || (paras[i + 1] && hasClaim(paras[i + 1]!));
    return Boolean(nearClaim) && p.length >= CONTEXT_MIN_CHARS;
  });

  const blocks: Block[] = [];
  let stretch: Paragraph[] = [];
  const flush = () => {
    const chars = stretch.reduce((n, p) => n + p.length, 0);
    if (stretch.length >= FOLD_MIN_PARAS || (stretch.length > 1 && chars >= FOLD_MIN_CHARS)) {
      blocks.push({ kind: "fold", paras: stretch });
    } else {
      for (const para of stretch) blocks.push({ kind: "para", para });
    }
    stretch = [];
  };
  paras.forEach((p, i) => {
    if (keep[i]) {
      flush();
      blocks.push({ kind: "para", para: p });
    } else {
      stretch.push(p);
    }
  });
  flush();

  return { blocks, unlocated };
}
