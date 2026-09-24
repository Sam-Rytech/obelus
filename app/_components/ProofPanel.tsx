/** The proof for the selected claim(s): verdict, why, and the primary source itself. */
import { formatUtc, type Entry } from "./report-model";
import { VerdictBadge } from "./VerdictBadge";

export function ProofCard({ entry }: { entry: Entry }) {
  return (
    <section className="proof" aria-label={`${entry.kind}: proof`}>
      <div className="proof-head">
        <VerdictBadge category={entry.category} />
        {entry.qualifier && <span className="proof-qualifier">{entry.qualifier}</span>}
      </div>
      <p className="proof-kind">{entry.kind}</p>
      <blockquote className="proof-quote">{entry.quote}</blockquote>
      <p className="proof-reason">{entry.reason}.</p>
      {entry.evidence.map((e) => (
        <div className="evidence" key={`${e.url}-${e.fetchedAt}`}>
          <a href={e.url} target="_blank" rel="noreferrer" className="evidence-source">
            {e.source}
          </a>
          <span className="evidence-time">Read {formatUtc(e.fetchedAt)}</span>
          {e.excerpt && (
            <details className="evidence-raw">
              <summary>What the source returned</summary>
              <pre className="data">{e.excerpt}</pre>
            </details>
          )}
        </div>
      ))}
      {entry.evidence.length === 0 && entry.category !== "NOT_CHECKABLE" && (
        <p className="evidence-none">No source record to link for this one.</p>
      )}
    </section>
  );
}

export function ProofPanel({ entries }: { entries: Entry[] }) {
  if (!entries.length) {
    return <p className="proof-empty">Select a highlighted claim to see its proof.</p>;
  }
  return (
    <div className="proof-stack" aria-live="polite">
      {entries.map((e) => (
        <ProofCard key={e.id} entry={e} />
      ))}
    </div>
  );
}
