import type { Metadata } from "next";
import Link from "next/link";

import { GALLERY, type GalleryItem } from "@/src/lib/examples";
import { getReport } from "@/src/lib/store";
import { tally } from "@/src/lib/summary";

import { Mark } from "../_components/VerdictBadge";
import { buildEntries, headline, projectTitle, sourceLabel } from "../_components/report-model";

export const metadata: Metadata = {
  title: "Examples",
  description: "Real announcements and questions checked by Obelus, each with its proof.",
};

export const revalidate = 3600;

const GROUPS: { id: GalleryItem["group"]; title: string; sub: string }[] = [
  { id: "announcement", title: "Real announcements", sub: "Press releases as they were published, checked claim by claim." },
  { id: "question", title: "Listing questions", sub: "Ask whether a token is listed and Obelus asks each exchange directly." },
  { id: "test", title: "Test announcement", sub: "Written by the Obelus team, and labelled as such everywhere it appears." },
];

async function load(item: GalleryItem) {
  const report = await getReport(item.reportId).catch(() => null);
  if (!report) return null;
  const entries = buildEntries(report);
  const lead = headline(entries.filter((e) => e.category !== "NOT_CHECKABLE"));
  return {
    item,
    title: projectTitle(report),
    source: sourceLabel(report).label,
    question: report.mode === "question",
    answer: report.summary.split(". ")[0],
    lead,
    t: tally(report.results),
  };
}

export default async function ExamplesPage() {
  const cards = (await Promise.all(GALLERY.map(load))).filter((c) => c !== null);

  return (
    <div className="wrap">
      <header className="page-head">
        <h1 className="page-title">Examples</h1>
        <p className="page-sub">Open any of these to see the text, the marks and the source behind every one.</p>
      </header>

      {GROUPS.map((g) => {
        const group = cards.filter((c) => c.item.group === g.id);
        if (!group.length) return null;
        return (
          <section key={g.id} className="section gallery-group" aria-labelledby={`g-${g.id}`}>
            <div className="section-head">
              <h2 id={`g-${g.id}`}>{g.title}</h2>
              <p>{g.sub}</p>
            </div>
            <ul className="gallery">
              {group.map((c) => (
                <li key={c.item.reportId}>
                  <Link href={`/r/${c.item.reportId}`} className="gallery-card sheet">
                    <span className="gallery-source">{c.source}</span>
                    <span className="gallery-title">{c.title}</span>
                    {c.question ? (
                      <span className="gallery-quote">{c.answer}.</span>
                    ) : (
                      c.lead && (
                        <span className="gallery-quote">
                          <Mark category={c.lead.category} size="sm" />
                          <mark className="hl" data-category={c.lead.category}>
                            {c.lead.quote.length > 110 ? `${c.lead.quote.slice(0, 109)}…` : c.lead.quote}
                          </mark>
                        </span>
                      )
                    )}
                    <span className="gallery-tally">
                      <span data-category="VERIFIED">
                        <Mark category="VERIFIED" size="sm" /> {c.t.verified}
                      </span>
                      <span data-category="CONTRADICTED">
                        <Mark category="CONTRADICTED" size="sm" /> {c.t.contradicted}
                      </span>
                      <span data-category="UNVERIFIED">
                        <Mark category="UNVERIFIED" size="sm" /> {c.t.unverified}
                      </span>
                    </span>
                    <span className="gallery-note">{c.item.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
