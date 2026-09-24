import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { easChainById } from "@/src/lib/chains";
import type { Report } from "@/src/lib/schema";
import { getReport } from "@/src/lib/store";
import { looksLikeQuestion, QUESTION_HINT, tally } from "@/src/lib/summary";

import { ReportView } from "../../_components/ReportView";
import { ShareButton } from "../../_components/ShareButton";
import { Mark } from "../../_components/VerdictBadge";
import {
  annotateReport,
  buildEntries,
  formatUtc,
  isTestAnnouncement,
  projectTitle,
  sourceLabel,
} from "../../_components/report-model";

export const dynamic = "force-dynamic"; // the receipt is added after the report is written

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = await getReport(id).catch(() => null);
  if (!report) return { title: "Report not found" };
  const t = tally(report.results);
  return {
    title: `${projectTitle(report)}: ${t.verified} verified, ${t.contradicted} contradicted`,
    description: report.summary,
  };
}

function Receipt({ report }: { report: Report }) {
  if (!report.attestation) {
    return (
      <div className="rail-card">
        <p className="rail-title">Receipt pending</p>
        <p className="rail-text">The fingerprint is being recorded on Base. This takes a few seconds.</p>
        <Link href={`/r/${report.id}/verify`}>Check its fingerprint</Link>
      </div>
    );
  }
  const net = easChainById(report.attestation.chain);
  return (
    <div className="rail-card">
      <p className="rail-title">Receipt on {net.label}</p>
      <p className="rail-text">
        This report&rsquo;s fingerprint is recorded on-chain, so any later edit would show.
        {net.testnet && " It's on a test network while Obelus is being tested."}
      </p>
      <p className="rail-links">
        <Link href={`/r/${report.id}/verify`} className="button button-small button-quiet">
          Verify this report
        </Link>
        <a href={`${net.easscan}/attestation/view/${report.attestation.uid}`} target="_blank" rel="noreferrer">
          View on EASScan
        </a>
      </p>
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  const t = tally(report.results);
  const entries = buildEntries(report);
  const { blocks } = annotateReport(report);
  const question = report.mode === "question";
  const source = sourceLabel(report);
  const emptyMessage = looksLikeQuestion(report.input.fetchedText)
    ? QUESTION_HINT
    : "Obelus found no claims it could check here. It looks for exchange listings, audits, ownership, liquidity locks, partnerships and TVL figures.";

  return (
    <div className="wrap report">
      {isTestAnnouncement(report) && (
        <p className="test-label">Test announcement written by the Obelus team. Not a statement by this project.</p>
      )}

      <header className="report-head">
        <h1 className="report-title">{projectTitle(report)}</h1>
        <p className="report-meta">
          Checked {formatUtc(report.createdAt)} from{" "}
          {source.href ? (
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          ) : (
            source.label
          )}
        </p>
        {question && <p className="report-answer">{report.summary}</p>}
        {!question && report.claims.length > 0 && (
          <>
            <ul className="tally" aria-label="Verdict counts">
              <li data-category="VERIFIED">
                <Mark category="VERIFIED" size="sm" /> {t.verified} verified
              </li>
              <li data-category="CONTRADICTED">
                <Mark category="CONTRADICTED" size="sm" /> {t.contradicted} contradicted
              </li>
              <li data-category="UNVERIFIED">
                <Mark category="UNVERIFIED" size="sm" /> {t.unverified} unverified
              </li>
              {t.notCheckable > 0 && (
                <li data-category="NOT_CHECKABLE">
                  <Mark category="NOT_CHECKABLE" size="sm" /> {t.notCheckable} not checkable yet
                </li>
              )}
            </ul>
            <p className="tally-note">
              Select a highlighted claim to see its proof. Unverified means no source could confirm it, not that
              it&rsquo;s false.
            </p>
          </>
        )}
      </header>

      <ReportView
        blocks={blocks}
        entries={entries}
        question={question}
        emptyMessage={emptyMessage}
        rail={
          <>
            <Receipt report={report} />
            <div className="rail-share">
              <ShareButton title={`Obelus report: ${projectTitle(report)}`} />
              <Link href="/check">Check another</Link>
            </div>
          </>
        }
      />

      <details className="trace">
        <summary>How Obelus checked this ({report.trace.length} steps)</summary>
        <ol>
          {report.trace.map((s) => (
            <li key={`${s.t}-${s.step}`}>{s.step}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
