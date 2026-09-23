import type { Metadata } from "next";

import { Sign, Stamp } from "../_components/Sign";
import { SourceStatus } from "../_components/SourceStatus";

export const metadata: Metadata = {
  title: "How it checks",
  description: "How Obelus checks each kind of crypto claim, what counts as proof, and what it can't check yet.",
};

export default function MethodPage() {
  return (
    <article className="prose">
      <h1 className="title">How Obelus checks a claim</h1>
      <p className="lede">
        A language model reads the announcement and pulls out the claims, quoting each one word for word. It never
        decides whether a claim is true. That is done by plain code, reading the one source that can confirm the
        claim — and every mark links to that source.
      </p>

      <h2>The three marks</h2>
      <p>
        They are the signs scholars used in the margins of ancient manuscripts, with the meaning they had there.
      </p>
      <div className="legend">
        <div className="margined">
          <div className="sign" data-verdict="VERIFIED">
            <Sign verdict="VERIFIED" />
          </div>
          <div>
            <Stamp verdict="VERIFIED" press={false} /> The source confirms it. Origen marked lines attested by his
            source with this sign, the asteriskos. Some verified claims carry a caveat — read it.
          </div>
        </div>
        <div className="margined">
          <div className="sign" data-verdict="CONTRADICTED">
            <Sign verdict="CONTRADICTED" />
          </div>
          <div>
            <Stamp verdict="CONTRADICTED" press={false} /> The source says otherwise. This is the obelus, the mark
            Aristarchus put beside lines of Homer that didn&rsquo;t hold up.
          </div>
        </div>
        <div className="margined">
          <div className="sign" data-verdict="UNVERIFIED">
            <Sign verdict="UNVERIFIED" />
          </div>
          <div>
            <Stamp verdict="UNVERIFIED" press={false} /> No source could settle it. This does not mean the claim is
            false: not finding proof is never treated as disproof.
          </div>
        </div>
      </div>

      <h2>Exchange listings</h2>
      <p>
        Checked against the exchange&rsquo;s own public API. A market has to be live — many exchanges keep delisted
        markets in their lists, and BingX alone returns over 1,500 of them. WEEX also publishes each token&rsquo;s
        contract address, so on WEEX Obelus can tell when a listed ticker belongs to a different token — the
        classic copycat scam. BingX, Binance, Bybit, OKX and MEXC publish no addresses, so a listing there is
        marked verified with the caveat that the token itself is unconfirmed. A claim that something <em>will</em>{" "}
        be listed can&rsquo;t be checked yet, and says so.
      </p>

      <h2>Audits</h2>
      <p>
        CertiK claims are checked on CertiK&rsquo;s own project page, which states either how many audits it has
        delivered or &ldquo;Not Audited By CertiK&rdquo;. For other auditors, Obelus searches only the
        auditor&rsquo;s own website and needs a sentence that names the project as audited — auditors also write
        about projects that got hacked. A PDF on the project&rsquo;s own site never counts. Obelus confirms a
        report exists, not which contract it covered.
      </p>

      <h2>Ownership renounced</h2>
      <p>
        Read directly from the token contract on Base. If the owner is the zero or dead address, ownership is
        renounced — unless the contract is an upgradeable proxy whose admin can still replace the code, which is
        marked contradicted.
      </p>

      <h2>Liquidity locked</h2>
      <p>
        Obelus finds the token&rsquo;s main pool and reads, on Base, how much of it sits in a known locker or has
        been burned. It knows the UNCX lockers on Base, each confirmed on-chain before being trusted. Liquidity in
        a locker it doesn&rsquo;t know comes back unverified, not contradicted.
      </p>

      <h2>Partnerships</h2>
      <p>
        Only the partner can confirm a partnership, so Obelus searches only the partner&rsquo;s own website and
        needs a sentence naming the project as a partner. Being mentioned — say, on a price-feed page — isn&rsquo;t
        enough. A partnership is never marked contradicted: a partner staying quiet proves nothing.
      </p>

      <h2>Total value locked</h2>
      <p>
        Compared with DefiLlama&rsquo;s current figure, within 25%. &ldquo;Has crossed $4M&rdquo; is read as a
        minimum, so a larger TVL still matches. The figure DefiLlama reports, and when it was fetched, is always
        shown — claims can be out of date.
      </p>

      <h2>What Obelus can&rsquo;t check yet</h2>
      <ul>
        <li>On-chain claims on chains other than Base.</li>
        <li>Which contract an audit report actually covered.</li>
        <li>Lockers other than UNCX, and Uniswap v3/v4 positions.</li>
        <li>X accounts&rsquo; history — only the specific post you link.</li>
        <li>Claims of any other kind: they are shown, marked unverified, rather than left out.</li>
      </ul>

      <h2>Receipts</h2>
      <p>
        Every report&rsquo;s fingerprint — a keccak256 hash of its contents — is recorded on Base through the
        Ethereum Attestation Service. The verify link on each report recomputes the fingerprint in your browser and
        reads the record straight from the chain, so you don&rsquo;t have to trust Obelus that a report hasn&rsquo;t
        been changed.
      </p>

      <h2>Sources right now</h2>
      <SourceStatus />
    </article>
  );
}
