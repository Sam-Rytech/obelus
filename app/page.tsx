import { EXAMPLES } from "@/src/lib/examples";

import { Checker } from "./_components/Checker";

export default function Home() {
  return (
    <>
      <h1 className="title">Paste a crypto announcement. We&rsquo;ll check every claim.</h1>
      <p className="lede">
        Obelus finds each checkable claim — an exchange listing, an audit, a locked pool, a partnership — and
        checks it against the one source that can confirm it: the exchange&rsquo;s own API, the auditor&rsquo;s own
        page, the Base blockchain. Every mark comes with its proof.
      </p>
      <Checker examples={EXAMPLES} />

      <section className="uses" aria-labelledby="uses-title">
        <h2 id="uses-title">Who checks with Obelus</h2>
        <dl>
          <div>
            <dt>Before you buy</dt>
            <dd>
              Paste the post that&rsquo;s pumping a token, or just ask &ldquo;Is $PEPE listed on MEXC?&rdquo;
            </dd>
          </div>
          <div>
            <dt>In a Telegram group</dt>
            <dd>
              Reply <code>/check</code> to a shill message with{" "}
              <a href="https://t.me/Obelus_the_Bot" target="_blank" rel="noreferrer">
                @Obelus_the_Bot
              </a>{" "}
              and the whole group sees which claims hold up.
            </dd>
          </div>
          <div>
            <dt>Before a listing or a raise</dt>
            <dd>Exchanges and launchpads run a project&rsquo;s announcements before they list it or let it raise.</dd>
          </div>
          <div>
            <dt>Before you republish</dt>
            <dd>Editors check a press release in seconds. Honest projects share their report as proof.</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
