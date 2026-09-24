import type { Metadata } from "next";
import Link from "next/link";

import { EAS_ADDRESS, SCHEMA } from "@/src/lib/eas";

export const metadata: Metadata = {
  title: "Developers",
  description: "Call Obelus from your own code or bot, verify its receipts yourself, or add it to a Telegram group.",
};

const BASE = (process.env.PUBLIC_BASE_URL || "https://obelus-five.vercel.app").replace(/\/$/, "");

const CHECK_CURL = `curl -N ${BASE}/api/check \\
  -H "content-type: application/json" \\
  -d '{"input": "Is $PEPE listed on MEXC?"}'`;

const CHECK_STREAM = `event: trace
data: {"t":"2026-09-23T20:49:02.114Z","step":"Reading the input"}

event: trace
data: {"t":"2026-09-23T20:49:02.391Z","step":"Checking MEXC listing for PEPE"}

event: done
data: {"reportId":"dAQh83lgcq","counts":{"verified":1,"contradicted":0,"unverified":0}}`;

const REPORT_CURL = `curl ${BASE}/api/report/dAQh83lgcq`;

const REPORT_JSON = `{
  "id": "dAQh83lgcq",
  "project": { "ticker": "PEPE", "chain": "base" },
  "claims": [
    { "id": "c1", "type": "EXCHANGE_LISTING", "quote": "Is $PEPE listed on MEXC?",
      "params": { "exchange": "MEXC", "market": "spot" } }
  ],
  "results": [
    { "claimId": "c1", "verdict": "VERIFIED",
      "qualifier": "Ticker listed — contract unconfirmed",
      "reason": "LISTED_CONTRACT_UNCONFIRMED — PEPEUSDT on MEXC …",
      "evidence": [{ "source": "MEXC public API", "url": "https://api.mexc.com/…",
                     "fetchedAt": "…", "excerpt": "…" }] }
  ],
  "reportHash": "0x…",
  "attestation": { "uid": "0x…", "txHash": "0x…", "chain": "base-sepolia" }
}`;

export default function DevelopersPage() {
  return (
    <div className="wrap narrow dev">
      <header className="page-head">
        <h1 className="page-title">Build with Obelus</h1>
        <p className="page-sub">
          Call it from your own code or bot, check its receipts without trusting it, or add it to a Telegram group.
        </p>
      </header>

      <nav className="dev-toc" aria-label="On this page">
        <a href="#check">Run a check</a>
        <a href="#report">Read a report</a>
        <a href="#receipts">Verify a receipt</a>
        <a href="#telegram">Telegram bot</a>
      </nav>

      <section id="check" className="section dev-section">
        <h2>Run a check</h2>
        <p>
          <code>POST /api/check</code> with a link, the announcement text or a listing question. The response is a
          stream of server-sent events: one <code>trace</code> per step, then <code>done</code> with the report id, or{" "}
          <code>error</code> with a code and a message.
        </p>
        <pre className="code">{CHECK_CURL}</pre>
        <pre className="code code-output">{CHECK_STREAM}</pre>
        <p className="fine-print">
          10 checks per hour per IP address. Input up to 20,000 characters. A check takes 3 to 10 seconds.
        </p>
      </section>

      <section id="report" className="section dev-section">
        <h2>Read a report</h2>
        <p>
          <code>GET /api/report/:id</code> returns the whole report: every claim with its exact quote, every verdict
          with its reason code and evidence, and the receipt. Verdicts are <code>VERIFIED</code>,{" "}
          <code>CONTRADICTED</code> or <code>UNVERIFIED</code>. Unverified never means false.
        </p>
        <pre className="code">{REPORT_CURL}</pre>
        <pre className="code code-output">{REPORT_JSON}</pre>
      </section>

      <section id="receipts" className="section dev-section">
        <h2>Verify a receipt</h2>
        <p>
          Each report&rsquo;s fingerprint is attested with EAS at <code>{EAS_ADDRESS}</code> on Base, with this schema:
        </p>
        <pre className="code">{SCHEMA}</pre>
        <ol className="dev-steps">
          <li>
            Fetch the report and remove <code>attestation</code> and <code>reportHash</code>.
          </li>
          <li>Serialise it as JSON with keys sorted at every level and no whitespace, then hash it with keccak256.</li>
          <li>
            Read the attestation by its <code>uid</code> and compare its <code>reportHash</code> with yours.
          </li>
        </ol>
        <p className="fine-print">
          Every report&rsquo;s verify page does exactly this in your browser. Try it on{" "}
          <Link href="/r/dAQh83lgcq/verify">an example</Link>.
        </p>
      </section>

      <section id="telegram" className="section dev-section">
        <h2>Telegram bot</h2>
        <dl className="commands">
          <div>
            <dt>
              <code>/check &lt;link or text&gt;</code>
            </dt>
            <dd>Checks a post, a page or pasted text.</dd>
          </div>
          <div>
            <dt>
              Reply <code>/check</code>
            </dt>
            <dd>Checks the message you replied to. This is the one to use in groups.</dd>
          </div>
          <div>
            <dt>
              <code>/check is $PEPE listed on MEXC?</code>
            </dt>
            <dd>Asks the exchanges directly.</dd>
          </div>
          <div>
            <dt>
              <code>/method</code>
            </dt>
            <dd>How Obelus decides, in one message.</dd>
          </div>
        </dl>
        <p className="dev-actions">
          <a className="button" href="https://t.me/Obelus_the_Bot?startgroup=true" target="_blank" rel="noreferrer">
            Add to a group
          </a>
          <a className="button button-quiet" href="https://t.me/Obelus_the_Bot" target="_blank" rel="noreferrer">
            Message the bot
          </a>
        </p>
      </section>
    </div>
  );
}
