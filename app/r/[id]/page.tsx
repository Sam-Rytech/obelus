import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { CheckResult, Claim, ClaimType, Report, Verdict } from "@/src/lib/schema";
import { getReport } from "@/src/lib/store";

import { ShareButton } from "../../_components/ShareButton";
import { Sign, Stamp } from "../../_components/Sign";

export const dynamic = "force-dynamic"; // the receipt is added after the report is written

const CLAIM_KIND: Record<ClaimType, string> = {
  EXCHANGE_LISTING: "Exchange listing",
  AUDIT: "Security audit",
  OWNERSHIP_RENOUNCED: "Ownership renounced",
  LIQUIDITY_LOCK: "Liquidity lock",
  PARTNERSHIP: "Partnership",
  TVL: "Total value locked",
  OTHER: "Other claim",
};

const INPUT_KIND = { x: "an X post", url: "a web page", text: "pasted text" } as const;

/** §15: the synthetic example must always be labelled as such. */
function isTestAnnouncement(r: Report) {
  return /TEST ANNOUNCEMENT\s*[—-]\s*written by the Obelus team/i.test(r.input.fetchedText);
}

/** Reasons are "CODE — explanation"; people read the explanation. */
function plain(reason: string) {
  const i = reason.indexOf(" — ");
  const text = i === -1 ? reason : reason.slice(i + 3);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function code(reason: string) {
  return reason.split(/[ —:]/)[0] ?? reason;
}

function counts(results: CheckResult[]) {
  const n = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  return { VERIFIED: n("VERIFIED"), CONTRADICTED: n("CONTRADICTED"), UNVERIFIED: n("UNVERIFIED") };
}

function projectTitle(r: Report) {
  const { name, ticker } = r.project;
  if (name && ticker) return `${name} (${ticker})`;
  return name ?? ticker ?? "Unnamed project";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = await getReport(id).catch(() => null);
  if (!report) return { title: "Report not found" };
  const c = counts(report.results);
  return {
    title: `${projectTitle(report)}: ${c.VERIFIED} verified, ${c.CONTRADICTED} contradicted`,
    description: report.summary,
  };
}

function ClaimEntry({ claim, result, index }: { claim: Claim; result: CheckResult; index: number }) {
  return (
    <li className="margined">
      <div className="sign" data-verdict={result.verdict}>
        <Sign verdict={result.verdict} />
      </div>
      <div>
        <p className="claim-quote">{claim.quote.replace(/\s+/g, " ").trim()}</p>
        <p className="claim-kind">
          {CLAIM_KIND[claim.type]}
          {typeof claim.params.exchange === "string" && ` on ${claim.params.exchange}`}
          {typeof claim.params.auditor === "string" && ` by ${claim.params.auditor}`}
          {typeof claim.params.partner === "string" && ` with ${claim.params.partner}`}
        </p>

        <div className="claim-verdict">
          <Stamp verdict={result.verdict} index={index} />
          {result.qualifier && <span className="claim-qualifier">{result.qualifier}</span>}
        </div>

        <p className="claim-reason" title={code(result.reason)}>
          {plain(result.reason)}.
        </p>

        {result.evidence.map((e) => (
          <p className="proof" key={`${e.url}-${e.fetchedAt}`}>
            Proof:{" "}
            <a href={e.url} target="_blank" rel="noreferrer">
              {e.source}
            </a>
            <span className="proof-excerpt data">{e.excerpt}</span>
          </p>
        ))}
      </div>
    </li>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();

  const c = counts(report.results);
  const byClaim = new Map(report.results.map((r) => [r.claimId, r]));
  const checked = new Date(report.createdAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  return (
    <article>
      {isTestAnnouncement(report) && (
        <p className="test-label">Test announcement written by the Obelus team — not a statement by this project</p>
      )}

      <h1 className="title">{projectTitle(report)}</h1>

      <div className="meta meta-list">
        {report.project.contract && (
          <span>
            Token{" "}
            <a
              className="data"
              href={`https://basescan.org/token/${report.project.contract}`}
              target="_blank"
              rel="noreferrer"
            >
              {report.project.contract}
            </a>{" "}
            on Base{report.project.contractSource === "resolved" ? ", found by Obelus (not stated in the announcement)" : ""}
          </span>
        )}
        <span>
          Checked {checked} UTC from{" "}
          {report.input.kind === "text" ? (
            INPUT_KIND.text
          ) : (
            <a href={report.input.value} target="_blank" rel="noreferrer">
              {INPUT_KIND[report.input.kind]}
            </a>
          )}
        </span>
      </div>

      <p className="tally" aria-label="Verdict counts">
        <span data-verdict="VERIFIED">
          <Sign verdict="VERIFIED" /> {c.VERIFIED} verified
        </span>
        <span data-verdict="CONTRADICTED">
          <Sign verdict="CONTRADICTED" /> {c.CONTRADICTED} contradicted
        </span>
        <span data-verdict="UNVERIFIED">
          <Sign verdict="UNVERIFIED" /> {c.UNVERIFIED} unverified
        </span>
      </p>

      <p className="summary">{report.summary}</p>

      <div className="receipt">
        {report.attestation ? (
          <>
            Receipt on Base:{" "}
            <a
              href={`https://base.easscan.org/attestation/view/${report.attestation.uid}`}
              target="_blank"
              rel="noreferrer"
            >
              view the attestation
            </a>
            . Anyone can <Link href={`/r/${report.id}/verify`}>check this report hasn&rsquo;t been edited</Link>.
          </>
        ) : (
          <>
            Receipt pending — this report&rsquo;s fingerprint hasn&rsquo;t been recorded on Base yet.{" "}
            <Link href={`/r/${report.id}/verify`}>Check its fingerprint</Link>.
          </>
        )}
      </div>

      {report.claims.length === 0 ? (
        <p className="summary">
          No checkable claims were found. Obelus looks for exchange listings, audits, ownership, liquidity locks,
          partnerships and TVL figures.
        </p>
      ) : (
        <ol className="claims">
          {report.claims.map((claim, i) => {
            const result = byClaim.get(claim.id);
            return result ? <ClaimEntry key={claim.id} claim={claim} result={result} index={i} /> : null;
          })}
        </ol>
      )}

      <details className="trace">
        <summary>How Obelus checked this ({report.trace.length} steps)</summary>
        <ol>
          {report.trace.map((t) => (
            <li key={`${t.t}-${t.step}`}>{t.step}</li>
          ))}
        </ol>
      </details>

      <p className="actions">
        <Link href="/" className="button">
          Check another announcement
        </Link>
        <ShareButton title={`Obelus report: ${projectTitle(report)}`} />
        <Link href={`/r/${report.id}/verify`}>Verify this report</Link>
      </p>
    </article>
  );
}
