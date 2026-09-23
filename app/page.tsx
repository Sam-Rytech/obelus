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
    </>
  );
}
