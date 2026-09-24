/**
 * Verdict marks and badges. Colour comes from `data-category` in CSS; the badge always
 * carries the word, so colour is never the only signal.
 */
import { Asteriskos, Obelus, Query } from "./Sign";
import type { Category } from "./report-model";

export const CATEGORY_WORD: Record<Category, string> = {
  VERIFIED: "Verified",
  CONTRADICTED: "Contradicted",
  UNVERIFIED: "Unverified",
  NOT_CHECKABLE: "Not checkable yet",
};

function Dash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 12h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function MarkIcon({ category }: { category: Category }) {
  if (category === "VERIFIED") return <Asteriskos />;
  if (category === "CONTRADICTED") return <Obelus />;
  if (category === "UNVERIFIED") return <Query />;
  return <Dash />;
}

export function Mark({ category, size = "md" }: { category: Category; size?: "sm" | "md" | "lg" }) {
  return (
    <span className="mark" data-category={category} data-size={size}>
      <MarkIcon category={category} />
    </span>
  );
}

export function VerdictBadge({ category }: { category: Category }) {
  return (
    <span className="badge" data-category={category}>
      <MarkIcon category={category} />
      {CATEGORY_WORD[category]}
    </span>
  );
}
