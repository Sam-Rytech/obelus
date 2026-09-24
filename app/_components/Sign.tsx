/**
 * The critical signs of ancient textual scholarship, used as verdict marks.
 *
 *   ※ asteriskos — Origen marked text attested by the source   -> VERIFIED
 *   ÷ obelus     — Aristarchus marked a line that doesn't hold  -> CONTRADICTED
 *   ?            — no source could settle it                    -> UNVERIFIED
 *
 * Drawn as SVG so they render identically everywhere — few fonts carry ※.
 * Colour comes from `currentColor`; the stamp beside each sign carries the word, so the
 * sign is never the only way a verdict is communicated.
 */
import type { Verdict } from "@/src/lib/schema";

export function Obelus({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="5.4" r="2" fill="currentColor" />
      <circle cx="12" cy="18.6" r="2" fill="currentColor" />
    </svg>
  );
}

export function Asteriskos() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="4.2" r="1.7" fill="currentColor" />
      <circle cx="12" cy="19.8" r="1.7" fill="currentColor" />
      <circle cx="4.2" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19.8" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function Query() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.6 8.4a3.5 3.5 0 1 1 5.3 3c-1.2.7-1.9 1.5-1.9 2.9v.6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="19.3" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function Sign({ verdict }: { verdict: Verdict }) {
  if (verdict === "VERIFIED") return <Asteriskos />;
  if (verdict === "CONTRADICTED") return <Obelus />;
  return <Query />;
}
