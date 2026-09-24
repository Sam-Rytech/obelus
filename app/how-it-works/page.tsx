import type { Metadata } from "next";
import Link from "next/link";

import { Mark } from "../_components/VerdictBadge";
import type { Category } from "../_components/report-model";

export const metadata: Metadata = {
  title: "How it works",
  description: "How Obelus checks each kind of crypto claim, what counts as proof, and what it can't check yet.",
};

const MARKS: { category: Category; word: string; origin: string }[] = [
  { category: "VERIFIED", word: "Verified", origin: "Origen’s asteriskos, for lines his source attested." },
  { category: "CONTRADICTED", word: "Contradicted", origin: "Aristarchus’s obelus, for lines of Homer that didn’t hold up." },
  { category: "UNVERIFIED", word: "Unverified", origin: "No source could settle it. Not finding proof is never treated as disproof." },
];

const TYPES = [
  {
    name: "Exchange listings",
    source: "The exchange’s own API: WEEX, BingX, Binance, Bybit, OKX and MEXC.",
    verified: "The market is live. On WEEX, the contract it lists must also match the announced token.",
    contradicted:
      "The exchange shows the market delisted, WEEX lists a different token under the same ticker, or MEXC, whose list is complete, has no market.",
    unknown: "The listing is announced for later, or the exchange didn’t answer.",
  },
  {
    name: "Audits",
    source: "CertiK’s own project page, or the auditor’s own website.",
    verified: "CertiK lists at least one delivered audit, or the auditor’s site names the project as audited.",
    contradicted: "CertiK’s page says “Not Audited By CertiK”.",
    unknown: "The auditor has no record of it, or isn’t one Obelus knows.",
  },
  {
    name: "Ownership renounced",
    source: "The token contract on Base.",
    verified: "The owner is the zero or dead address, and no admin can upgrade the contract.",
    contradicted: "The owner is a live address, or an admin can still replace the code.",
    unknown: "The contract has no owner function to read.",
  },
  {
    name: "Liquidity locked",
    source: "The token’s main pool on Base, and the UNCX lockers.",
    verified: "Most of the pool sits in a known locker or has been burned.",
    contradicted: "Never. A locker Obelus doesn’t know proves nothing.",
    unknown: "Under 10% is in a known locker, or the pool is a type Obelus can’t read.",
  },
  {
    name: "Partnerships",
    source: "The partner’s own website, for 50 partners.",
    verified: "The partner’s site names the project in partnership terms.",
    contradicted: "Never. A partner staying quiet proves nothing.",
    unknown: "No such page, or a partner Obelus doesn’t know yet.",
  },
  {
    name: "Total value locked",
    source: "DefiLlama.",
    verified: "Within 25% of the claim, or above a “has crossed $X” floor.",
    contradicted: "Off by more than that.",
    unknown: "The protocol isn’t on DefiLlama.",
  },
];

const RECEIPT_STEPS = [
  { title: "The report", text: "Claims, verdicts and proof, as JSON." },
  { title: "Its fingerprint", text: "A keccak256 hash of that JSON." },
  { title: "Recorded on Base", text: "Written to the Ethereum Attestation Service." },
  { title: "Checked by you", text: "Your browser re-hashes the report and compares." },
];

const LIMITS = [
  "On-chain claims on chains other than Base.",
  "Which contract an audit actually covered.",
  "Lockers other than UNCX, and Uniswap v3 and v4 positions.",
  "An X account’s history. Obelus reads the post you link.",
  "Any other kind of claim. It is shown and marked not checkable, never dropped.",
];

export default function HowItWorksPage() {
  return (
    <div className="wrap">
      <header className="page-head">
        <h1 className="page-title">How Obelus checks a claim</h1>
        <p className="page-sub">
          A model reads. Code decides. Every mark links to the one source that can settle the claim.
        </p>
      </header>

      <section className="section" aria-labelledby="rule-title">
        <h2 id="rule-title" className="visually-hidden">
          The rule
        </h2>
        <div className="rule">
          <div>
            <p className="rule-title">The model reads</p>
            <p>
              A language model pulls each claim out of the text and quotes it word for word. A quote that isn&rsquo;t
              in the text is thrown away, so the model can&rsquo;t invent a claim.
            </p>
          </div>
          <div>
            <p className="rule-title">Code decides</p>
            <p>
              Every verdict comes from code reading a primary source. A source that doesn&rsquo;t answer is shown as
              exactly that, never mistaken for an answer.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="marks-title">
        <div className="section-head">
          <h2 id="marks-title">The three marks</h2>
          <p>The signs ancient editors wrote in the margins, with the meanings they had there.</p>
        </div>
        <ul className="marks-row">
          {MARKS.map((m) => (
            <li key={m.category} data-category={m.category}>
              <Mark category={m.category} size="lg" />
              <p className="marks-word">{m.word}</p>
              <p className="marks-line">{m.origin}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="types-title">
        <div className="section-head">
          <h2 id="types-title">Each kind of claim</h2>
        </div>
        <div className="types">
          {TYPES.map((t) => (
            <article key={t.name} className="type">
              <div className="type-head">
                <h3>{t.name}</h3>
                <p>{t.source}</p>
              </div>
              <dl className="type-rules">
                <div data-category="VERIFIED">
                  <dt>
                    <Mark category="VERIFIED" size="sm" /> Verified when
                  </dt>
                  <dd>{t.verified}</dd>
                </div>
                <div data-category="CONTRADICTED">
                  <dt>
                    <Mark category="CONTRADICTED" size="sm" /> Contradicted when
                  </dt>
                  <dd>{t.contradicted}</dd>
                </div>
                <div data-category="UNVERIFIED">
                  <dt>
                    <Mark category="UNVERIFIED" size="sm" /> Unverified when
                  </dt>
                  <dd>{t.unknown}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="receipt-title">
        <div className="section-head">
          <h2 id="receipt-title">Receipts on Base</h2>
          <p>So you don&rsquo;t have to trust Obelus that a report hasn&rsquo;t been changed.</p>
        </div>
        <ol className="flow">
          {RECEIPT_STEPS.map((s) => (
            <li key={s.title}>
              <p className="flow-title">{s.title}</p>
              <p className="flow-text">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="limits-title">
        <div className="section-head">
          <h2 id="limits-title">What Obelus can&rsquo;t check yet</h2>
        </div>
        <ul className="limits">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="fine-print">
          Which sources are answering right now: <Link href="/status">source status</Link>.
        </p>
      </section>
    </div>
  );
}
