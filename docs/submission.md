# Orion submission — Obelus

Paste-ready text for the submission form (architecture §19 structure). Links to fill in before
submitting are marked **TODO**.

- Website: https://obelus-agent.vercel.app
- GitHub: https://github.com/Sam-Rytech/obelus (**TODO: make public**)
- Telegram: https://t.me/Obelus_the_Bot (**TODO: channel link if separate**)
- X: **TODO**
- Demo video: **TODO**

---

Short description (about 690 characters, for fields with a length limit):

> Obelus is a fact-checking agent for crypto announcements. Paste an X post, a press-release link or the
> text, or ask "Is $PEPE listed on MEXC?". A model only pulls out the claims, quoting each one exactly.
> Code then checks each claim against the one source that can confirm it: the exchange's own API (WEEX,
> BingX, Binance, Bybit, OKX, MEXC), CertiK's project page, the Base blockchain, the partner's own website
> or DefiLlama. Each claim is marked verified, contradicted or unverified, with a link to its proof.
> Missing proof is never called false. Every report gets a tamper-proof receipt on Base. It works on the
> web, in Telegram and through an API. Live: https://obelus-agent.vercel.app

Form choices: Strategy **Risk Management**, Category **Risk**, Target blockchain **Base**, no token.

**Obelus is a fact-checking agent for crypto announcements. It checks each claim against the one source
that can confirm it, for anyone about to buy, list or republish on the strength of a press release.**

Chainstory analysed 2,893 crypto press releases: only about 2% held meaningful news, and more than 60%
promoted projects showing signs of fraud. The same release is paid onto dozens of sites, so one fake
"listed on BingX" or "audited by CertiK" ends up looking like coverage everywhere. AI-text detectors tell
you whether a machine wrote the text. They can't tell you whether the claims are true.

**How it works.** Paste an X post, a link or the text. A model pulls out each claim with its exact quote,
and a code guard drops any quote that isn't in the source word for word. Then each claim goes to its
primary source:
- listings to the exchange's own API: WEEX, BingX, Binance, Bybit, OKX and MEXC;
- audits to CertiK Skynet's project page or the auditor's own site;
- ownership and liquidity locks to Base RPC;
- partnerships to the partner's own domain;
- TVL to DefiLlama.
Each claim gets a mark: ※ verified, ÷ contradicted or ? unverified, and every mark links to its proof. It
works on the web and in Telegram (`/check`, or reply `/check` to any message). Other agents can call the
same JSON API.

**The model reads, code decides.** The model never assigns a verdict or a number. Absence of proof is
unverified, never contradicted: contradicted needs a primary source that says otherwise, such as CertiK's
page reading "Not Audited By CertiK", a delisted market, or a WEEX listing whose contract differs from the
announced token. That last one is the same-ticker scam. An unreachable or region-blocked source is shown
as exactly that, never as an answer.

**Real runs.** I ran Obelus through the live site on 22 real announcements from Chainwire, openPR,
CoinGabbar, Cryptopolitan and BingX Learn. 20 of them could be checked; one page was gone and one blocked
the fetch. They made 104 claims, and only 34 were checkable against any primary source. Of those 34, 3
were verified and 0 contradicted. The other 31 were unconfirmed by the one source that could have
confirmed them, including a "CertiK-audited" project with no CertiK record. The median check took 3–5
seconds, and no source outage was mistaken for a verdict.

A targeted re-check of 2025 listing announcements caught a real case. Apex Fusion's release "AP3X Token Listed on MEXC" is still carried by three sites, and MEXC's own
full symbol list no longer has AP3X. CoinGecko confirms it trades only on DEXes now.

**Receipts.** Every report is hashed (keccak256 of canonical JSON) and attested with EAS on Base, along
with its verdict counts. On any report's verify page, your browser re-hashes the report and compares it
with the attestation read straight from Base.

**Deliberately not built in v1:**
- searching X history (we read the posts you link);
- reading audit PDFs to confirm scope;
- confirming the token behind BingX, Binance, Bybit, OKX and MEXC listings (they publish no contract addresses; WEEX does);
- lockers beyond UNCX, and on-chain checks off Base;
- partners outside a 50-entry registry of verified official domains.
Guessing any of these would let a fake claim verify.

**Try it in 30 seconds:** open https://obelus-agent.vercel.app. Under the box, click **"The test
announcement"**, which is labelled as a test we wrote about AERO and shows all three marks at once. Click
any highlighted claim to see its proof, then **"Verify this report"** to check its receipt on Base. Or
paste any crypto press-release link, or ask "Is $PEPE listed on MEXC?". More real checks are at
https://obelus-agent.vercel.app/examples.
