import type { Metadata } from "next";

import { SourceStatus } from "../_components/SourceStatus";

export const metadata: Metadata = {
  title: "Source status",
  description: "Which of the primary sources Obelus checks against are answering right now.",
};

export default function StatusPage() {
  return (
    <div className="wrap narrow">
      <header className="page-head">
        <h1 className="page-title">Source status</h1>
        <p className="page-sub">
          When a source doesn&rsquo;t answer, claims that rely on it come back unverified. Obelus never guesses.
        </p>
      </header>
      <SourceStatus />
    </div>
  );
}
