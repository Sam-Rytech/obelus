"use client";

/**
 * The annotated report: the announcement in the middle, marks in its margin, and the proof
 * for the selected claim in the rail. Below 960px the rail moves under the document and
 * the proof opens as a bottom sheet instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { Block } from "@/src/lib/annotate";

import { AnnotatedText } from "./AnnotatedText";
import { ProofPanel } from "./ProofPanel";
import { QuestionAnswers } from "./QuestionAnswers";
import { Mark } from "./VerdictBadge";
import { headline, type Category, type Entry } from "./report-model";

type Props = {
  blocks: Block[];
  entries: Entry[];
  question: boolean;
  /** Shown instead of the claims index when nothing checkable was found. */
  emptyMessage?: string;
  /** Receipt card and share button, rendered on the server. */
  rail: React.ReactNode;
};

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 959px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function ReportView({ blocks, entries, question, emptyMessage, rail }: Props) {
  const categoryOf = useMemo(
    () => Object.fromEntries(entries.map((e) => [e.id, e.category])) as Record<string, Category>,
    [entries],
  );
  const first = headline(entries.filter((e) => e.category !== "NOT_CHECKABLE")) ?? headline(entries);
  const [selected, setSelected] = useState<string[]>(first ? [first.id] : []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = useNarrow();
  const closeRef = useRef<HTMLButtonElement>(null);

  function select(ids: string[]) {
    setSelected(ids);
    if (narrow) setSheetOpen(true);
  }

  function jumpTo(id: string) {
    select([id]);
    const target = document.querySelector(`[data-claims~="${id}"]`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }

  useEffect(() => {
    if (sheetOpen) closeRef.current?.focus();
  }, [sheetOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sheetOpen) setSheetOpen(false);
      else setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const chosen = entries.filter((e) => selected.includes(e.id));

  return (
    <div className="report-grid">
      <div className="report-main">
        {question ? (
          <QuestionAnswers entries={entries} />
        ) : (
          <article className="sheet doc-sheet" aria-label="The announcement, with each claim marked">
            <AnnotatedText blocks={blocks} categoryOf={categoryOf} selected={selected} onSelect={select} />
          </article>
        )}

        {!question && entries.length > 0 && (
          <details className="claims-index">
            <summary>All claims ({entries.length})</summary>
            <ol>
              {entries.map((e) => (
                <li key={e.id}>
                  <button type="button" className="index-row" onClick={() => jumpTo(e.id)}>
                    <Mark category={e.category} size="sm" />
                    <span className="index-quote">{e.quote}</span>
                    <span className="index-kind">{e.kind}</span>
                  </button>
                </li>
              ))}
            </ol>
          </details>
        )}
        {entries.length === 0 && emptyMessage && <p className="notice">{emptyMessage}</p>}
      </div>

      <aside className="report-rail" aria-label="Proof and receipt">
        <div className="rail-inner">
          {!question && entries.length > 0 && (
            <div className="rail-proof">
              <ProofPanel entries={chosen} />
            </div>
          )}
          {rail}
        </div>
      </aside>

      {narrow && sheetOpen && chosen.length > 0 && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Proof"
            onClick={(e) => e.stopPropagation()}
          >
            <button ref={closeRef} type="button" className="sheet-close" onClick={() => setSheetOpen(false)}>
              Close
            </button>
            <ProofPanel entries={chosen} />
          </div>
        </div>
      )}
    </div>
  );
}
