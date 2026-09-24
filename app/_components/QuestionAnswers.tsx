/** A listing question's answer: one row per exchange, straight from that exchange's API. */
import type { Entry } from "./report-model";
import { CATEGORY_WORD, Mark } from "./VerdictBadge";

const ANSWER: Record<Entry["category"], string> = {
  VERIFIED: "Trading",
  CONTRADICTED: "Not trading",
  UNVERIFIED: "No answer",
  NOT_CHECKABLE: "No answer",
};

export function QuestionAnswers({ entries }: { entries: Entry[] }) {
  return (
    <ul className="answers sheet">
      {entries.map((e) => {
        const answer = e.reason.startsWith("The announcement describes a future") || /not yet trading/i.test(e.reason)
          ? "Announced, not trading yet"
          : /^Not found in|^No market/i.test(e.reason) && e.category === "UNVERIFIED"
            ? "Not found"
            : ANSWER[e.category];
        return (
          <li key={e.id} className="answer" data-category={e.category}>
            <Mark category={e.category} />
            <div className="answer-body">
              <p className="answer-line">
                <strong>{e.exchange ?? e.kind}</strong>
                <span className="answer-word" aria-label={CATEGORY_WORD[e.category]}>
                  {answer}
                </span>
              </p>
              <p className="answer-reason">
                {e.reason}.{e.qualifier ? ` ${e.qualifier}.` : ""}
              </p>
            </div>
            {e.evidence[0] && (
              <a className="answer-proof" href={e.evidence[0].url} target="_blank" rel="noreferrer">
                Proof
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
