import Link from "next/link";

import { EXAMPLES } from "@/src/lib/examples";
import { getReport } from "@/src/lib/store";

import { AnnotatedText } from "./_components/AnnotatedText";
import { Checker } from "./_components/Checker";
import { Mark } from "./_components/VerdictBadge";
import { annotateReport, buildEntries, type Category } from "./_components/report-model";

// The demo report is fixed; refresh it hourly rather than on every visit.
export const revalidate = 3600;

const DEMO_REPORT = "srezxyJ1aX";

const MARKS: { category: Category; word: string; line: string }[] = [
  { category: "VERIFIED", word: "Verified", line: "The source confirms it." },
  { category: "CONTRADICTED", word: "Contradicted", line: "The source says otherwise." },
  { category: "UNVERIFIED", word: "Unverified", line: "No source could settle it. That isn’t the same as false." },
];

const STEPS = [
  {
    title: "Read the claims",
    text: "A language model pulls out each claim and quotes it word for word. It never decides whether a claim is true.",
  },
  {
    title: "Ask the source",
    text: "Code checks each claim with the one source that can confirm it: the exchange’s API, the auditor’s page, the blockchain.",
  },
  {
    title: "Record a receipt",
    text: "The report’s fingerprint is written to Base, so nobody can quietly edit the verdicts later.",
  },
];

const SOURCES = [
  { claim: "Exchange listings", names: ["WEEX", "BingX", "Binance", "Bybit", "OKX", "MEXC"] },
  { claim: "Audits", names: ["CertiK", "Hacken", "OpenZeppelin", "Trail of Bits", "Halborn", "and 6 more"] },
  { claim: "Ownership and liquidity", names: ["Base", "UNCX lockers"] },
  { claim: "Partnerships", names: ["The partner’s own website, for 50 partners"] },
  { claim: "Total value locked", names: ["DefiLlama"] },
];

const USES = [
  { who: "Before you buy", what: "Paste the post that’s pumping a token, or just ask “Is $PEPE listed on MEXC?”" },
  { who: "In a Telegram group", what: "Reply /check to a shill message, and the whole group sees which claims hold up." },
  { who: "Before a listing or a raise", what: "Exchanges and launchpads run a project’s announcements before they list it." },
  { who: "Before you republish", what: "Editors check a press release in seconds. Honest projects share the report as proof." },
];

async function loadDemo() {
  try {
    const report = await getReport(DEMO_REPORT);
    if (!report) return null;
    const categoryOf = Object.fromEntries(buildEntries(report).map((e) => [e.id, e.category]));
    return { blocks: annotateReport(report).blocks, categoryOf };
  } catch {
    return null;
  }
}

export default async function Home() {
  const demo = await loadDemo();

  return (
    <>
      <section className="wrap hero">
        <div className="hero-copy">
          <h1 className="hero-title">Every claim, checked at its source.</h1>
          <p className="hero-sub">
            Paste a crypto announcement, a post or a link. Obelus finds each claim, asks the exchange, auditor or
            blockchain that can confirm it, and shows you the proof.
          </p>
          <Checker variant="hero" examples={EXAMPLES} />
        </div>

        {demo && (
          <figure className="hero-demo">
            <div className="sheet doc-sheet demo-sheet">
              <AnnotatedText blocks={demo.blocks} categoryOf={demo.categoryOf} />
            </div>
            <figcaption>
              A test announcement we wrote about a real token, marked by Obelus.{" "}
              <Link href={`/r/${DEMO_REPORT}`}>See its proof</Link>
            </figcaption>
          </figure>
        )}
      </section>

      <section className="wrap section" aria-labelledby="marks-title">
        <div className="section-head">
          <h2 id="marks-title">Three marks, borrowed from ancient scholars</h2>
          <p>
            Editors at the Library of Alexandria marked the lines of Homer they doubted. Obelus uses their signs.
          </p>
        </div>
        <ul className="marks-row">
          {MARKS.map((m) => (
            <li key={m.category} data-category={m.category}>
              <Mark category={m.category} size="lg" />
              <p className="marks-word">{m.word}</p>
              <p className="marks-line">{m.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap section" aria-labelledby="steps-title">
        <div className="section-head">
          <h2 id="steps-title">How a check works</h2>
          <p>
            About five seconds, start to finish. <Link href="/how-it-works">How each kind of claim is checked</Link>
          </p>
        </div>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <p className="steps-title">{s.title}</p>
              <p className="steps-text">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap section" aria-labelledby="sources-title">
        <div className="section-head">
          <h2 id="sources-title">Where the answers come from</h2>
          <p>Only the source that can settle a claim counts. A press release repeating it never does.</p>
        </div>
        <dl className="sources">
          {SOURCES.map((s) => (
            <div key={s.claim}>
              <dt>{s.claim}</dt>
              <dd>
                {s.names.map((n) => (
                  <span key={n} className="source-name">
                    {n}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap section" aria-labelledby="uses-title">
        <div className="section-head">
          <h2 id="uses-title">Who checks with Obelus</h2>
        </div>
        <dl className="uses">
          {USES.map((u) => (
            <div key={u.who}>
              <dt>{u.who}</dt>
              <dd>{u.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap section">
        <div className="band">
          <div>
            <h2 className="band-title">Keep your group honest</h2>
            <p className="band-text">
              Add @Obelus_the_Bot to a Telegram group, then reply /check to any message that makes a claim.
            </p>
          </div>
          <div className="band-actions">
            <a className="button" href="https://t.me/Obelus_the_Bot?startgroup=true" target="_blank" rel="noreferrer">
              Add to a group
            </a>
            <a className="button button-quiet" href="https://t.me/Obelus_the_Bot" target="_blank" rel="noreferrer">
              Message the bot
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
