"use client";

/**
 * The announcement, with each claim highlighted in its verdict colour and its mark in the
 * margin. Highlights are buttons: selecting one shows its proof (ReportView). Stretches
 * with no claims are folded — one click away, never hidden for good.
 */
import { useState } from "react";

import type { Block, Paragraph } from "@/src/lib/annotate";

import { CATEGORY_WORD, Mark } from "./VerdictBadge";
import { PRIORITY, type Category } from "./report-model";

type Props = {
  blocks: Block[];
  categoryOf: Record<string, Category>;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
};

function worst(ids: string[], categoryOf: Record<string, Category>): Category {
  return ids.map((id) => categoryOf[id] ?? "UNVERIFIED").sort((a, b) => PRIORITY[a] - PRIORITY[b])[0]!;
}

function Para({ para, categoryOf, selected, onSelect }: Props & { para: Paragraph }) {
  let order = 0;
  return (
    <div className="doc-para" data-claims={para.starts.length > 0 || undefined}>
      <div className="doc-margin" aria-hidden="true">
        {para.starts.map((id) => (
          <span
            key={id}
            className="doc-margin-mark"
            style={{ "--i": order++ } as React.CSSProperties}
            onClick={onSelect ? () => onSelect([id]) : undefined}
          >
            <Mark category={categoryOf[id] ?? "UNVERIFIED"} size="sm" />
          </span>
        ))}
      </div>
      <p className="doc-text">
        {para.runs.map((run, i) => {
          if (!run.claimIds.length) return <span key={i}>{run.text}</span>;
          const category = worst(run.claimIds, categoryOf);
          const isSelected = run.claimIds.some((id) => selected?.includes(id));
          if (!onSelect) {
            return (
              <mark key={i} className="hl" data-category={category}>
                {run.text}
              </mark>
            );
          }
          // A span, not a <button>: browsers render buttons as unbreakable boxes, and a
          // highlighted sentence has to wrap across lines like the text around it.
          return (
            <span
              key={i}
              role="button"
              tabIndex={0}
              className="hl"
              data-category={category}
              data-claims={run.claimIds.join(" ")}
              aria-pressed={isSelected}
              aria-label={`${CATEGORY_WORD[category]}: ${run.text.replace(/\s+/g, " ").trim()}`}
              onClick={() => onSelect(run.claimIds)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(run.claimIds);
                }
              }}
            >
              {run.text}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function Fold({ paras, ...props }: Props & { paras: Paragraph[] }) {
  const [open, setOpen] = useState(false);
  if (open) return paras.map((p) => <Para key={p.index} para={p} {...props} />);
  return (
    <div className="doc-para doc-fold">
      <div className="doc-margin" />
      <button type="button" className="fold-button" onClick={() => setOpen(true)}>
        {paras.length} {paras.length === 1 ? "paragraph" : "paragraphs"} with no claims
        <span className="fold-show">Show</span>
      </button>
    </div>
  );
}

export function AnnotatedText(props: Props) {
  return (
    <div className="doc">
      {props.blocks.map((b, i) =>
        b.kind === "para" ? (
          <Para key={`p${b.para.index}`} para={b.para} {...props} />
        ) : (
          <Fold key={`f${i}`} paras={b.paras} {...props} />
        ),
      )}
    </div>
  );
}
