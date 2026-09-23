# Obelus — Architecture

> **Obelus is a fact-checker for crypto announcements.**
> Paste an announcement, an X post or a project page. Obelus extracts every checkable claim
> ("listed on BingX", "audited by CertiK", "liquidity locked", "partnered with X"), checks each one
> against the **only source that can confirm it**, and stamps it **VERIFIED**, **CONTRADICTED** or
> **UNVERIFIED** — with a link to the proof and a tamper-evident receipt on Base.

**The name:** the *obelus* (Greek *obelos*) is the mark scholars at the Library of Alexandria drew in the
margin to flag a line as false or not genuine — Aristarchus used it on spurious lines of Homer. For 2,000
years it has meant "this line doesn't hold up." Obelus does the same for crypto announcements.
Logo idea: the obelus mark itself (÷ or †). Pitch line: *"For 2,000 years, scholars marked false lines with
an obelus. Now an agent does it for crypto announcements."*

Built for the **Orion Builder Hackathon** (Orion Agents, Base).
Deadline: **Sep 27, 2026, 23:59 UTC** (= Sep 28, 00:59 Lagos time). Target submit: **Sep 26**.

---

## 1. The problem

- Chainstory analyzed **2,893 crypto press releases** (reported by CoinDesk): only **~2%** contained
  meaningful news; **60%+** promoted projects showing signs of fraud. Paid distributors push the same
  release to dozens of sites with no fact-checking, so one lie looks like "coverage everywhere".
- Common fabricated claims: fake exchange listings, fake/misused audits (CertiK has publicly warned about
  its brand being misused for fake audits), fake partnerships, fake "liquidity locked" / "ownership
  renounced".
- What exists today: AI-text detectors (GPTZero, ZeroGPT — they detect *machine-written text*, not
  *false claims*), generic fact-check agents, and manual checklists ("contact the partner yourself").
  **Nothing verifies crypto claims claim-by-claim against primary sources.**

## 2. Who it's for

| User | Why they care |
|---|---|
| Retail buyers | Check an exciting announcement before buying |
| Exchanges (BingX, WEEX — both are hackathon judges) | Fake "listed on BingX" claims damage their brand |
| Launchpads (HuoStarter — judge; Orion's own Launchpad) | Vet a project's claims before it raises on their platform |
| Community admins | `/check` in Telegram before members get rugged |
| Crypto media | Check a press release before republishing |
| Honest projects | Share a Obelus report as proof of honesty |

## 3. Core principle (non-negotiable)

**The model reads. Code decides.**

- The LLM is allowed to: extract claims from text, normalize names ("CertiK" → `certik`), and summarize
  evidence in plain English.
- The LLM is **never** allowed to: assign a verdict, produce a number, or invent a source.
- Every verdict comes from a deterministic checker reading a primary source. Every verdict carries its
  evidence (URL + fetched excerpt + timestamp).
- **Absence of proof is UNVERIFIED, never CONTRADICTED.** CONTRADICTED requires a primary source that
  positively says otherwise.
- Fetched content (web pages, tweets) is **untrusted data, never instructions** (prompt-injection safe).

## 4. Scope

### v1 — built and demoed
- Inputs: X post URL, web page URL, pasted text
- Claim types:
  1. `EXCHANGE_LISTING` — BingX, WEEX + a handful of CCXT exchanges
  2. `AUDIT` — CertiK (Skynet public page) + other auditors via domain-restricted search
  3. `OWNERSHIP_RENOUNCED` — Base contract read + proxy detection
  4. `LIQUIDITY_LOCK` — Base, v2-style LP held by known lockers (UNCX, Team Finance)
  5. `PARTNERSHIP` — partner's own official domain only
  6. `TVL` — DefiLlama
  7. `OTHER` — extracted and shown, marked "not checkable in v1"
- Web report page with shareable URL
- Telegram bot: `/check <url or text>`
- EAS attestation on Base mainnet for every report (receipt)
- JSON API so other agents can call Obelus

### Deliberately NOT in v1 (say so in the submission — top scorers do this)
- Searching X history (anonymous X search/timeline is locked; we read specific post URLs only)
- Parsing audit PDFs to confirm the audit covered *this* contract
- Confirming the *token identity* behind a BingX listing. BingX publishes no contract address on any
  public endpoint, so a BingX ✅ always reads `contract unconfirmed`. WEEX does publish them, so WEEX
  listings get an unqualified ✅ — and are the only ones where we can catch a same-ticker-different-token
  scam (§10.1)
- Lockers beyond UNCX + Team Finance; Uniswap v3 NFT locks (stretch)
- Chains other than Base for on-chain checks
- x402 payments (over-represented in the field; not needed)

## 5. System overview

```
             ┌──────────────┐     ┌──────────────┐
  Web UI ───►│  POST /api/  │◄────│ Telegram bot │
  Agents ───►│    check     │     │  (webhook)   │
             └──────┬───────┘     └──────────────┘
                    ▼
        ┌───────────────────────┐
   1    │  INGEST               │  X post (FxTwitter → oEmbed fallback)
        │                       │  Web page (Tavily Extract / fetch)
        │                       │  Pasted text
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐
   2    │  EXTRACT (LLM)        │  → Claim[] (Zod-validated)
        │                       │  + project {name, ticker, contract?}
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐
   3    │  RESOLVE (agent step) │  Missing contract? → DexScreener search on Base
        │  bounded tool budget  │  Normalize auditor / exchange / partner via registries
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐
   4    │  ROUTE + CHECK        │  one deterministic checker per claim type
        │  (parallel, cached)   │  → Evidence[] + Verdict
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐
   5    │  REPORT               │  canonical JSON → keccak256 reportHash
        │                       │  summary built by code from results (see below)
        └──────────┬────────────┘
                   ▼
        ┌───────────────────────┐
   6    │  ANCHOR               │  EAS attestation on Base (reportHash + counts)
        │                       │  store report in Redis → /r/[id]
        └───────────────────────┘
```

**Summary (deviation, Sep 23):** step 5's plain-English summary is built by code from `results`
(`src/lib/summary.ts`), not written by the LLM. §8 requires it to contain no verdict absent from
`results`, which no prompt can guarantee of free text; built from the results it is correct by
construction, and each report costs one model call (extraction) instead of two.

### Where the "agent" is
Obelus is an agent, not a script, because it **plans and adapts per input**:
- Decides which checkers each announcement needs (routing is driven by what's in the text).
- When the token contract isn't stated, it **chooses** to resolve it (DexScreener) before on-chain checks,
  and asks the user to confirm if multiple tokens match.
- When a primary source is ambiguous (e.g. ticker listed but no contract match), it **chooses** a
  follow-up lookup (exchange coin/network endpoint) within a fixed budget.
- Streams its decision trace live to the UI ("Found 5 claims → checking BingX API → …").
- Budget: max 12 tool calls per report; unfinished checks return UNVERIFIED with reason `BUDGET_EXHAUSTED`.

## 6. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language front to back |
| App | Next.js (App Router) | UI + API routes in one deploy |
| Package manager | pnpm | Fast, reliable on Windows |
| Validation | Zod | Every LLM output + every external response validated |
| LLM | Anthropic API (`claude-sonnet-5`), provider-swappable | Strong structured extraction; keep an adapter so Gemini/Groq can be swapped in |
| EVM reads | viem | Base contract reads, storage slots |
| Exchanges | direct fetch for BingX/WEEX; `ccxt` for others | BingX/WEEX public endpoints need no keys |
| Search/extract | Tavily (`include_domains`) | Domain-restricted search = primary-source search |
| X posts | FxTwitter API (`api.fxtwitter.com`), fallback `publish.twitter.com/oembed` | No API key |
| TVL | DefiLlama (`api.llama.fi`) | Free, no key |
| Token/pool lookup | DexScreener public API | Free (verify endpoints in spike) |
| Receipts | EAS on Base, called with **viem** (Sep 24: the eas-sdk + ethers stack was dropped — one `attest()` call doesn't justify it, and viem also runs in the browser for the verify page) | EAS predeploy on Base |
| Storage | Upstash Redis (free tier) | Reports, caches, rate limits |
| Telegram | grammY (webhook mode) | Works on Vercel serverless |
| Hosting | Vercel (free) | Demo link that just works |
| UI | Tailwind CSS | Speed |

## 7. Verified external sources (researched Sep 22, 2026)

| Source | Endpoint | Auth | Notes |
|---|---|---|---|
| BingX spot symbols | `GET https://open-api.bingx.com/openApi/spot/v1/common/symbols` | None | **Verified Sep 22:** 2,271 symbols, format `BASE-USDT`. `status` decides the verdict (§10.1) — **not** mere presence. **No contract address on any public BingX endpoint** |
| BingX 24h tickers | `GET https://open-api.bingx.com/openApi/spot/v1/ticker/24hr` | None | Backup existence check |
| WEEX spot markets | `GET https://api-spot.weex.com/api/v3/exchangeInfo` | None | **Verified Sep 22:** 3,508 symbols with structured `baseAsset`/`quoteAsset`/`status` (`TRADING`/`HALT`). **Use this, not `v2/public/products`**, which returns bare strings (`MRVLONUSDT_SPBL`) with no base/quote separator |
| WEEX coin contracts | `GET https://api-spot.weex.com/api/v3/coins` | None | **Verified Sep 22:** `networkList[]` with `network` + `contractAddress` + `contractAddressUrl`; 467 of 3,971 coins carry an address. **The only exchange source that can confirm the contract** — see §10.1 |
| MEXC spot | `GET https://api.mexc.com/api/v3/exchangeInfo?symbol=<T>USDT` | None | **Verified Sep 22:** 921 B, 171 ms warm. Returns only live symbols (all 1,950 are status `"1"`), so absence is evidence. Gate needs `isSpotTradingAllowed` too — 91 are status 1 but not tradeable |
| Bybit spot | `GET https://api.bytick.com/v5/market/instruments-info?category=spot&symbol=<T>USDT` | None | **Verified Sep 22:** 637 B, 1.4 s warm. `baseCoin`/`quoteCoin`/`status` (`Trading` = live). Uses Bybit's alternate domain — `api.bybit.com` does not resolve from the dev network |
| Binance spot | `GET https://api.binance.com/api/v3/exchangeInfo?symbol=<T>USDT` | None | `symbols[0]` with `baseAsset`/`quoteAsset`/`status` (`TRADING` = live). **Not verified from the dev network** — DNS-blocked from Lagos on every documented host including `data-api.binance.vision` and `api.binance.us`. Shape validated at runtime; a mismatch degrades to UNVERIFIED |
| OKX spot | `GET https://www.okx.com/api/v5/public/instruments?instType=SPOT&instId=<T>-USDT` | None | `data[0]` with `baseCcy`/`quoteCcy`/`state` (`live`, `preopen` = announced). **Not verified from the dev network** — DNS-blocked, same as Binance |
| CertiK project page | `https://skynet.certik.com/projects/<slug>` | None | **Verified Sep 22:** server-rendered, no Cloudflare block. `__NEXT_DATA__` is obfuscated and holds no audit data — parse the rendered HTML. Discriminator is the **"Not Audited By CertiK"** badge (§10.2). Partner API is gated — don't use |
| DefiLlama TVL | `https://api.llama.fi/tvl/<slug>` | None | **Verified Sep 22:** bare current number, **17 bytes**; a miss returns `Protocol not found`. Use this per-claim; `/protocols` (8.9 MB decompressed, 8,325 protocols, 876 on Base) only as a cached slug map, `/protocol/<slug>` (13.9 MB) never. Cite DefiLlama as source |
| FxTwitter | `https://api.fxtwitter.com/<user>/status/<id>` | None | Set a custom User-Agent; rate-limited → cache |
| X oEmbed | `https://publish.twitter.com/oembed?url=<tweet_url>` | None | Minimal data (HTML blockquote with text); fallback only |
| Tavily | search + extract, `include_domains` | API key | Free: 1,000 credits/month, resets on the 1st; student plan covers hackathons |
| EAS on Base | EAS `0x4200000000000000000000000000000000000021`, SchemaRegistry `0x4200000000000000000000000000000000000020` | Wallet | Explorer: base.easscan.org |
| Base RPC | `https://mainnet.base.org` (public) or Alchemy free | Optional key | Use Alchemy if public RPC rate-limits |

**Settled Sep 22 by live probe** (see Progress.md → Spike results): BingX status semantics; BingX exposes no
contract addresses (spot, futures, or otherwise — the only such endpoint needs an API key); WEEX exposes
both structured markets and contract addresses; CertiK's parse discriminator; DefiLlama's lightweight TVL
endpoint; DexScreener shapes (`chainId`, `dexId`, `pairAddress`, `baseToken.address`, `liquidity`).

**Must still be verified in Day-1 spikes:** which CCXT exchanges expose per-network contract addresses;
UNCX + Team Finance locker contract addresses **on Base** (take from official docs only — never from
memory); reading a known EAS attestation on Base; FxTwitter success shape against live tweets.

## 8. Data model (Zod)

```ts
// src/lib/schema.ts
export const ClaimType = z.enum([
  "EXCHANGE_LISTING", "AUDIT", "OWNERSHIP_RENOUNCED",
  "LIQUIDITY_LOCK", "PARTNERSHIP", "TVL", "OTHER",
]);

export const Claim = z.object({
  id: z.string(),                 // "c1", "c2", ...
  type: ClaimType,
  quote: z.string(),              // exact span from the input text (must be a substring — enforced)
  params: z.record(z.string(), z.unknown()), // type-specific, validated per checker
});
// params per type:
// EXCHANGE_LISTING  { exchange: string, market?: "spot" | "futures" }
// AUDIT             { auditor: string }
// OWNERSHIP_RENOUNCED {}
// LIQUIDITY_LOCK    { durationText?: string, locker?: string }
// PARTNERSHIP       { partner: string }
// TVL               { amountUsd: number, asOfText?: string }

export const Project = z.object({
  name: z.string().optional(),
  ticker: z.string().optional(),
  contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  chain: z.literal("base").default("base"),
});

export const Verdict = z.enum(["VERIFIED", "CONTRADICTED", "UNVERIFIED"]);

export const Evidence = z.object({
  source: z.string(),        // "BingX public API", "CertiK Skynet", "Base RPC", ...
  url: z.string().url(),     // what a human can open to check
  fetchedAt: z.string(),     // ISO timestamp
  excerpt: z.string(),       // the exact data that decided the verdict (trimmed)
});

export const CheckResult = z.object({
  claimId: z.string(),
  verdict: Verdict,
  qualifier: z.string().optional(), // e.g. "Ticker listed, contract unconfirmed", "Proxy: upgradeable"
  reason: z.string(),               // deterministic reason code + short text
  evidence: z.array(Evidence),
});

export const Report = z.object({
  id: z.string(),                    // short id for /r/[id]
  input: z.object({ kind: z.enum(["x", "url", "text"]), value: z.string(), fetchedText: z.string() }),
  project: Project,
  claims: z.array(Claim),
  results: z.array(CheckResult),
  summary: z.string(),               // LLM plain-English, cannot contain verdicts not in results
  trace: z.array(z.object({ t: z.string(), step: z.string() })),
  engineVersion: z.string(),         // git short sha
  createdAt: z.string(),
  reportHash: z.string(),            // keccak256 of canonical JSON (see §11)
  attestation: z.object({ uid: z.string(), txHash: z.string() }).optional(),
});
```

**Quote guard:** after extraction, drop any claim whose `quote` is not an exact substring of the input
text. This stops the model inventing claims.

## 9. Registries (curated JSON — the backbone of "primary source")

`src/registry/exchanges.json`
```json
[{ "id": "bingx", "names": ["BingX"], "checker": "bingx" },
 { "id": "weex",  "names": ["WEEX"],  "checker": "weex" },
 { "id": "binance", "names": ["Binance"], "checker": "ccxt" }]
```
`src/registry/auditors.json` — `{ id, names[], domains[] }` e.g. certik (`skynet.certik.com`, `certik.com`),
hacken (`hacken.io`), peckshield (`github.com/peckshield`), slowmist (`slowmist.com`, `github.com/slowmist`),
openzeppelin (`blog.openzeppelin.com`), trailofbits (`github.com/trailofbits`), quantstamp, halborn,
cyfrin, spearbit, zellic, sherlock, code4rena. **Verify each domain by visiting it before adding.**

`src/registry/partners.json` — `{ id, names[], domains[] }` for the ~50 most name-dropped partners
(Chainlink, Coinbase, Base, Binance, Google Cloud, Microsoft, Polygon, LayerZero, Circle, OpenAI, …).
Unknown partner → UNVERIFIED with reason `PARTNER_NOT_IN_REGISTRY`.

`src/registry/lockers.base.json` — `{ id, name, addresses[], lpType: "v2" }` for UNCX and Team Finance
on Base. **Addresses copied from official docs, with the docs URL stored next to each address.**

## 10. Checkers — exact specifications

Every checker has the signature:
```ts
type Checker = (claim: Claim, project: Project, ctx: Ctx) => Promise<CheckResult>;
```
`ctx` provides: cached fetch, Tavily client, viem client, trace logger, budget counter.

### 10.1 EXCHANGE_LISTING

**A listing claim is only VERIFIED if the market is currently live.** Mere presence in a symbol list is not
enough: 1,581 of BingX's 2,271 spot symbols are delisted entries that are still returned by the API.

1. Resolve exchange via registry. Unknown exchange → UNVERIFIED `EXCHANGE_NOT_SUPPORTED`.
2. Fetch the exchange's full symbol list (cache 10 min), and its coin/network list where one exists.
3. Find markets whose **base asset** equals the ticker. Base must come from a structured field
   (`baseAsset`) or an unambiguous separator (`BASE-USDT`) — never from splitting a concatenated string.
4. **Status gate.** Only VERIFIED requires a *positive* live status; everything else fails closed.

   | Exchange | live (eligible for VERIFIED) | provably delisted → CONTRADICTED `MARKET_DELISTED` | everything else → UNVERIFIED |
   |---|---|---|---|
   | BingX | `status === 1` (643 symbols) | `status === 0` **and** `offTime` in the past (1,229) | `status === 0` with no past `offTime` (352) → `MARKET_NOT_LIVE`; `10`/`5`/`25` (47) → `UNKNOWN_MARKET_STATUS` |
   | WEEX | `status === "TRADING"` (2,454) | — | `status === "HALT"` (1,054) → `MARKET_NOT_LIVE` |

   **Gate on `status` alone.** The two obvious alternative signals are both unreliable, measured Sep 22
   across all 2,271 BingX symbols, and neither may enter a verdict:
   - `offTime` does not mean delisted — **18 `status: 1` symbols carry a past `offTime`** (e.g. `SKYAI-USDT`).
   - `apiStateBuy` does not mean tradeable — **1,302 of the 1,581 not-live symbols still report `true`**.

   The list also contains non-production entries (31 `TEST*-USDT` symbols), another reason presence alone
   proves nothing.

   A claim about a market that is merely *not live* is UNVERIFIED, not CONTRADICTED: we can show it isn't
   trading now, but not that it never was — that distinction is exactly what §3 requires. `status: 10` also
   covers the "will list" case, so it reinforces `FUTURE_CLAIM` when the extractor flags future tense.
5. Verdict for a **live** market:
   - No market with that base at all → **CONTRADICTED** `NOT_IN_EXCHANGE_MARKET_LIST`
     (evidence: endpoint URL + "0 live markets for TICKER").
   - Exchange exposes a contract address for the ticker on Base that matches `project.contract`
     (case-insensitive) → **VERIFIED**, unqualified.
   - Contract differs → **CONTRADICTED** `DIFFERENT_TOKEN_SAME_TICKER` (this is the scam case — highlight it).
   - No contract data available for that coin → **VERIFIED** with qualifier
     `Ticker listed — contract unconfirmed`.
6. **Which exchange can reach an unqualified VERIFIED:**
   - **WEEX can.** `api/v3/coins` → `networkList[]` gives `contractAddress` per network (467 of 3,971
     coins carry one; **42 have a `BASE`-network address**). This is the only public exchange source in v1
     that can confirm token identity, so WEEX is the primary listing checker and the only one that can
     produce `DIFFERENT_TOKEN_SAME_TICKER`. Outside those 42, WEEX also falls back to the qualified branch
     — so an unqualified ✅ is genuinely rare, and the report must not imply otherwise.
   - **BingX cannot, ever.** No public endpoint carries a contract address — not spot symbols, not
     `/swap/v2/quote/contracts`; the one that does (`/wallets/v1/capital/config/getall`) requires an API
     key. Every BingX VERIFIED therefore carries the `contract unconfirmed` qualifier. Say so plainly in
     the report and the submission.
   - **CCXT is not used on the live path.** Measured Sep 22: `gate.loadMarkets()` took **46.5 s** plus
     10.8 s for `fetchCurrencies()` — more than the entire 60 s pipeline budget — and kucoin/bitget/binance
     took 4–6 s each against the 8 s per-call ceiling. gate, kucoin and bitget are therefore
     `unsupported` in v1 (they return UNVERIFIED `EXCHANGE_NOT_SUPPORTED`), despite being the exchanges
     that *do* expose Base contracts (gate 154, kucoin 79, bitget 66). Worth revisiting via direct
     endpoints after the hackathon.
   - **Binance, Bybit, OKX and MEXC use direct single-symbol REST** instead (§7). None publishes a
     contract address, so all four are ticker-only.
   - **MEXC's list is exhaustive** — all 1,950 symbols are status `"1"`, i.e. it omits delisted markets —
     so absence from MEXC genuinely disproves a listing claim. BingX, WEEX and the others retain non-live
     entries, so absence there stays UNVERIFIED. This distinction is carried by `listIsExhaustive` and is
     the only thing that makes a CONTRADICTED-on-absence verdict sound.
   - **An unreachable source is never an answer.** A DNS failure, timeout, 5xx, empty body or non-JSON
     body must return UNVERIFIED `SOURCE_ERROR`, never "no market found" — otherwise a network blip would
     produce CONTRADICTED against an exhaustive list, i.e. a false ❌ on a genuine listing. A 4xx *is* an
     answer on these APIs (several return 400 for an unknown symbol) and maps to "no market".

     **Only a `BASE`-keyed network may enter a verdict.** Most coins expose an address on *some* chain
     (bitget: 3,993 of 5,059), and comparing a Base token against, say, a BSC address would manufacture a
     false `DIFFERENT_TOKEN_SAME_TICKER`. Match the network key against `/^base(evm|chain|mainnet)?$/i` so
     near-misses like `BASEDAI` cannot slip through.
   - **The contract-confirmable set is small everywhere** (WEEX 42, gate 154, kucoin 79, bitget 66), so the
     qualified ✅ is the common case, not the exception. The UI must make the two visually distinct.
7. **Future tense** (`params.tense = "future"`, "will list"): always UNVERIFIED `FUTURE_CLAIM`, whatever
   the market list says, with today's status in the qualifier ("Not on MEXC yet" / "Already trading on
   Binance"). A future listing can't be confirmed, and absence is exactly what a genuine upcoming listing
   looks like — so this is checked *before* the exhaustive-list rule, which would otherwise return ❌.
   Found in the first live run (Sep 23): "AERO will be listed on Binance" came back ✅.
8. **Inferred contracts can't contradict.** If the announcement stated no contract and Obelus resolved
   one via DexScreener (`project.contractSource = "resolved"`), a mismatch with the exchange's address is
   UNVERIFIED, not `DIFFERENT_TOKEN_SAME_TICKER` — the mismatch may be Obelus having picked a same-ticker
   clone. Resolution itself only proceeds when exactly one Base token matches the ticker, or exactly one
   also matches the project name; it never picks by highest liquidity.

### 10.2 AUDIT
1. Resolve auditor via registry. Unknown → UNVERIFIED `AUDITOR_NOT_IN_REGISTRY`.
2. **CertiK path.** Fetch `https://skynet.certik.com/projects/<slug>` **directly** (slug = project name
   lowercased, non-alphanumerics → `-`). Tavily search with `include_domains: ["skynet.certik.com"]` is the
   **fallback only**, used when the direct slug returns the not-found shell — this keeps the audit checker
   off the 1,000-credit monthly Tavily budget.

   Parse the **rendered HTML**, not `__NEXT_DATA__`: on Skynet that blob is obfuscated (`pageProps` is just
   `_e`) and contains no audit data.

   **Do not substring-match "Code Audit History"** — it is a static section heading present on every
   project page, audited or not. The discriminator is the badge:

   | Response | Verdict |
   |---|---|
   | **HTTP 404** — no such project | UNVERIFIED `NO_AUDITOR_RECORD_FOUND` (no parsing needed) |
   | 200 containing `Not Audited By CertiK` | **CONTRADICTED** `AUDITOR_PAGE_SAYS_NOT_AUDITED` |
   | 200, no badge, **"N Audits available" with N ≥ 1** | **VERIFIED** (evidence: Skynet URL + audit-history section text, incl. "Last Audit was delivered on …") |
   | 200, neither badge nor an audit count | UNVERIFIED `SOURCE_ERROR:certik` — unreadable, fail closed |
   | any other status | UNVERIFIED `SOURCE_ERROR:certik` (fail closed, §18) |

   Verified against `pancakeswap` and `polygon` (audited → no badge), `uniswap` and `aerodrome-finance`
   (not CertiK-audited → badge present), and a nonexistent slug (neither) on Sep 22.

   Audit titles are **not** present in the HTML as links or PDF URLs, so the Evidence `excerpt` must be the
   text of the audit-history section — don't build the checker expecting report links.
3. **Other auditors** (Hacken, SlowMist, OpenZeppelin, Quantstamp, Halborn, Cyfrin, Zellic, Trail of Bits,
   Code4rena, Sherlock — domains verified live Sep 23): Tavily search `"<project name>" audit` restricted to
   the auditor's domains.
   - A sentence on an auditor-controlled domain naming the project (whole word, case-insensitive) **and**
     using audit language (`audit`, `security review`, `security assessment`), without negating it
     ("not audited", "unaudited", "without an audit") → **VERIFIED**.
   - Named, but not in audit terms → UNVERIFIED `MENTION_ONLY`, page linked. An auditor's blog most often
     names a project in a *hack post-mortem*; name-on-domain alone would stamp "audited" ✅ on exactly the
     projects that got exploited. Same rule as partnerships (§10.5).
   - Otherwise UNVERIFIED `NO_AUDITOR_RECORD_FOUND`.
   - GitHub-hosted report repos (PeckShield, Trail of Bits' `publications`) are **not** registered: the
     domain check is by hostname, so `github.com` would let any repository speak for the auditor.
4. A PDF hosted on the **project's own site** never counts.
5. Qualifier on every VERIFIED audit: `Report exists — v1 does not confirm which contract it covered`.

### 10.3 OWNERSHIP_RENOUNCED
Needs `project.contract`.
1. `owner()` via viem. Reverts → UNVERIFIED `NO_OWNER_FUNCTION`.
2. Read EIP-1967 slots with `getStorageAt`:
   - implementation `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
   - admin `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`
3. Rules:
   - owner is `0x0` or `0x…dEaD` and **not** a proxy → **VERIFIED**.
   - owner is `0x0`/dead but proxy with non-zero admin → **CONTRADICTED** qualifier `Owner renounced, but contract is upgradeable by admin <addr>`.
   - owner is any other address → **CONTRADICTED** `OWNER_IS <addr>`.
4. Evidence URL: `https://basescan.org/address/<contract>#readContract`.

### 10.4 LIQUIDITY_LOCK
Needs `project.contract`.
1. DexScreener: find Base pairs for the token (`chainId === "base"`); take the top pair by `liquidity.usd`.
2. **Identify v2-style pairs by the `labels` field**, verified Sep 22: concentrated-liquidity pairs are
   labelled (`["v3"]`, `["v4"]`) while v2-style ERC-20 LP pairs have an empty `labels` array. For AERO the
   19 Base pairs split aerodrome=12 and pancakeswap=1 (unlabelled, v2-style) vs uniswap v3=4 and v4=2.
3. If the pair is v2-style (Uniswap v2 / Aerodrome volatile/stable = ERC-20 LP):
   - `totalSupply()` of LP, `balanceOf(locker)` for each registry locker address, plus `balanceOf(0x…dEaD)`.
   - locked% = (sum of locker balances) / totalSupply; burned% separately.
4. Rules:
   - locked% + burned% ≥ 90% → **VERIFIED** (qualifier shows locker name + %). Unlock date shown only if decoded (stretch).
   - between 10% and 90% → **VERIFIED** qualifier `Partially locked: X%`.
   - < 10% in known lockers → **UNVERIFIED** `LP_NOT_IN_KNOWN_LOCKER` (qualifier: "LP held by <top holder>").
     **Not CONTRADICTED** — our locker registry has two entries, so a project using any other legitimate
     locker would otherwise be stamped ❌ on nothing but our own ignorance. That is absence of proof, which
     §3 forbids us from treating as disproof.
   - The one CONTRADICTED case: LP demonstrably held by an **EOA** (no code at the address) or by the
     token deployer → **CONTRADICTED** `LP_HELD_BY_EOA` (qualifier names the holder). This is a primary
     source positively saying otherwise, which is what §3 requires.
   - v3/v4 pair → UNVERIFIED `LOCK_TYPE_NOT_SUPPORTED_V1`.

### 10.5 PARTNERSHIP
1. Resolve partner via registry. Unknown → UNVERIFIED `PARTNER_NOT_IN_REGISTRY`.
2. Tavily search `"<project name>"` with `include_domains: partner.domains`.
3. Rules (tightened Sep 23 — decided with Sam):
   - A **sentence** on a partner-domain page contains the project name (whole word, case-insensitive)
     **and** partnership language (`partner`/`partnership`/`collaborat*`/`integrat*`/`join forces`)
     → **VERIFIED** (evidence: that page + that sentence). Code decides via the fixed keyword list.
   - The name appears on the partner's site but never in partnership terms → UNVERIFIED `MENTION_ONLY`,
     page still linked. Why: every Tavily hit for "Aave" on `chain.link` was a Chainlink *price-feed* page,
     so the original name-match rule would have verified "partnered with Chainlink" for any token with a
     feed.
   - Name absent → UNVERIFIED `NO_PARTNER_CONFIRMATION`. **Never CONTRADICTED** (absence isn't proof).
   - Tavily returns results even for projects that don't exist (5 for a fabricated name), so the name is
     always matched in the content — result count means nothing.

### 10.6 TVL
1. Try `https://api.llama.fi/tvl/<slug>` first (slug = normalized project name). It returns the bare
   current number in **17 bytes** — `/protocols` is 8.9 MB and `/protocol/<slug>` 13.9 MB, neither of which
   belongs in a per-claim path inside the 60 s budget.
2. A miss returns the string `Protocol not found`, so treat a non-numeric body as a miss: fall back once to
   `/protocols` (8,325 entries), reduced to a name→slug map and cached 24 h, then retry `/tvl`.
3. Rules: within ±25% of claimed → **VERIFIED**; outside → **CONTRADICTED** (show actual); not listed → UNVERIFIED `NOT_ON_DEFILLAMA`.
   Qualifier includes DefiLlama's current number and fetch time (claims can be dated).
   - **Floor wording** ("crossed", "over", "more than", "surpassed", …, fixed list): the claim is a lower
     bound, so current TVL ≥ 75% of it is VERIFIED. "TVL has crossed $4M" is true of $40M.
   - **Name variants:** the full name is tried first, then without a generic suffix (finance, protocol,
     labs, network, exchange, dao, app) — "Aerodrome Finance" is DefiLlama's `aerodrome`. A match through a
     *shortened* name may VERIFY but never CONTRADICT (UNVERIFIED, "name match uncertain"): DefiLlama's
     "Nova" may be a different protocol from "Nova Finance".
   - DefiLlama unreachable → UNVERIFIED `SOURCE_ERROR`, never `NOT_ON_DEFILLAMA`.
4. Evidence URL: `https://defillama.com/protocol/<slug>`.

### 10.7 OTHER
Shown in the report with verdict UNVERIFIED `NOT_CHECKABLE_V1` — transparency over silence.

## 11. Receipts (EAS on Base)

- **Canonical JSON:** the Report object without `attestation` **and without `reportHash` itself**, keys sorted
  at every depth, no whitespace, undefined fields dropped, array order kept → `keccak256` → `reportHash`.
  Hashed *after* Zod parsing, so it matches exactly what is stored and served. Implemented isomorphically
  in `src/lib/hash.ts` (viem only) so the verify page runs the same code in the browser.
- **Schema** (register once with a script):
  `bytes32 reportHash, string reportUrl, uint8 verified, uint8 contradicted, uint8 unverified, string engineVersion`
- **Attest** from a dedicated server wallet (small ETH on Base, key in env). Non-revocable, no recipient.
- Store `uid` + `txHash` on the report; the report page links to `https://base.easscan.org/attestation/view/<uid>`.
- **Verify page:** `/r/[id]/verify` recomputes the hash in the browser from the report JSON and compares
  to the on-chain value. (Anyone can prove the report wasn't edited.)
- If attestation fails, the report still renders with "receipt pending" — never block the user on gas.

## 12. API

| Route | Method | Purpose |
|---|---|---|
| `/api/check` | POST `{ input: string }` | Runs pipeline; **streams** trace events (SSE), ends with `{ reportId }` |
| `/api/report/[id]` | GET | Full report JSON (for agents + verify page) |
| `/api/telegram` | POST | grammY webhook |
| `/api/health` | GET | Checks each upstream source; used by the status panel on the site |

Input detection: `x.com|twitter.com/.../status/<id>` → X; other `http(s)://` → URL; else text (max 8,000 chars).

Rate limiting: 10 checks / IP / hour (Upstash). Cache: exchange symbol lists 10 min; Tavily results 24 h;
CertiK pages 24 h; tweets 24 h.

## 13. UI

- **`/`** — hero: "Paste a crypto announcement. We'll check every claim." Input box + 3 one-click example
  buttons (see §15). Live trace streams below while checking.
- **`/r/[id]`** — report:
  - Header: project name/ticker/contract, counts (✅ n / ❌ n / ⚠️ n), receipt badge (EAS link).
  - One card per claim: quoted text → verdict stamp → qualifier → "Proof" (evidence links + excerpt).
  - Plain-English summary.
  - Collapsible decision trace.
  - Share button; "Verify this report" link.
- **`/method`** — how each claim type is checked, what counts as a primary source, what v1 can't do.
- Mobile-first; judges may open it on a phone.

## 14. Telegram bot

- `/obelus <url or text>` (alias `/check`) → reply: counts line + top 3 claims with stamps + link to full report.
- Works in groups (bot must be added; privacy mode fine because it responds to commands).
- `/start`, `/help`, `/method`.
- Webhook mode on Vercel: `webhookCallback(bot, "std/http")` in `/api/telegram`; set the webhook once
  with `setWebhook` to the production URL + secret token header.

## 15. Demo plan (judges try what they can run)

- **Example A — real, clean:** a genuine announcement from a well-known Base project → mostly ✅.
- **Example B — real, mixed:** a real announcement containing at least one claim that doesn't hold up.
  Find it during the build by running Obelus on real press releases from crypto PR wires.
- **Example C — labeled test:** a clearly-labeled synthetic announcement about a real Base token that mixes
  true and false claims (e.g. real CertiK status, fake WEEX listing, unconfirmed partnership) to show all
  three stamps in one run. The UI must label it "Test announcement written by the Obelus team".
- Never fabricate a "real" announcement. Never present Example C as a real project's statement.
- Pre-run all three so the report pages load instantly; the "run again live" button re-checks.

## 16. Environment variables

```
ANTHROPIC_API_KEY=
LLM_MODEL=claude-sonnet-5
TAVILY_API_KEY=
BASE_RPC_URL=https://mainnet.base.org
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
ATTESTER_PRIVATE_KEY=         # dedicated wallet, small ETH only, NEVER your registered wallet
EAS_SCHEMA_UID=
PUBLIC_BASE_URL=https://<your-app>.vercel.app
```
`.env.local` is git-ignored. Never commit keys. Rotate any key that ever appears in a commit.

## 17. Folder structure

```
obelus/
├─ app/
│  ├─ page.tsx                   # home + input + live trace
│  ├─ r/[id]/page.tsx            # report page
│  ├─ r/[id]/verify/page.tsx     # client-side hash verification
│  ├─ method/page.tsx
│  └─ api/
│     ├─ check/route.ts          # SSE pipeline
│     ├─ report/[id]/route.ts
│     ├─ telegram/route.ts
│     └─ health/route.ts
├─ src/
│  ├─ lib/
│  │  ├─ schema.ts               # Zod (§8)
│  │  ├─ pipeline.ts             # ingest → extract → resolve → check → report → anchor
│  │  ├─ ingest/{x.ts,url.ts,text.ts}
│  │  ├─ extract.ts              # LLM + quote guard
│  │  ├─ resolve.ts              # contract resolution, registry normalization
│  │  ├─ llm.ts                  # provider adapter
│  │  ├─ cache.ts, ratelimit.ts, trace.ts, budget.ts
│  │  ├─ hash.ts                 # canonical JSON + keccak256
│  │  └─ eas.ts                  # attest
│  ├─ checkers/
│  │  ├─ index.ts                # router: ClaimType → checker
│  │  ├─ exchange/{bingx.ts,weex.ts,ccxt.ts,index.ts}
│  │  ├─ audit.ts
│  │  ├─ ownership.ts
│  │  ├─ lock.ts
│  │  ├─ partnership.ts
│  │  └─ tvl.ts
│  ├─ registry/{exchanges,auditors,partners,lockers.base}.json
│  └─ bot/telegram.ts
├─ scripts/
│  ├─ register-schema.ts         # one-time EAS schema registration
│  ├─ spike-*.ts                 # Day-1 endpoint verification scripts
│  └─ run-fixture.ts             # run pipeline on a fixture from CLI
├─ fixtures/                     # saved announcements + expected verdicts
├─ tests/                        # vitest: one test file per checker
├─ architecture.md
└─ Progress.md
```

## 18. Security & robustness

- **Prompt injection:** extraction prompt wraps input in delimiters and states it is data; the model has no tools during extraction; output must pass Zod + quote guard.
- **SSRF:** URL ingest allows only `http(s)`, blocks private IP ranges and `localhost`, 10 s timeout, 2 MB cap.
- **Fail closed:** any checker error → UNVERIFIED with reason `SOURCE_ERROR:<name>`, never a guess.
- **No secrets client-side.** All upstream calls happen server-side.
- **Timeouts:** every external call ≤ 8 s; whole pipeline ≤ 60 s (Vercel limit — set `maxDuration`).
  Two measured exceptions: Tavily searches get 12 s (6–11 s measured from Lagos; checks run in parallel,
  so it still fits), and each claim's whole check is capped at 20 s, after which it is UNVERIFIED.
- **Public Base RPC** rate-limits at ~5 concurrent requests (`429 over rate limit`; JSON-RPC batching
  doesn't help). Reads are collapsed into Multicall3 where possible and retried with backoff; production
  should set an Alchemy URL in `BASE_RPC_URL`.
- **Cache values stay small:** Upstash caps a value at 1 MB, so large source lists (WEEX 1.7 MB, BingX
  670 KB, DefiLlama 8.9 MB) are reduced to the fields the checkers read before caching.
- **Attester wallet** holds only a few dollars of ETH.

## 19. Submission (Orion requirements)

Required: website, X profile, GitHub, Discord or Telegram link; demo link strongly recommended; ~$10 ETH
ignition fee paid from the **registered wallet** (Sam_rytech). Prizes are paid to the submitting wallet.

**Description structure** (matches what the 90+ AI-scored entries do):
1. One line: what it does and for whom.
2. The problem, with the Chainstory numbers.
3. How it works: claim → primary source → stamp, with named sources (BingX API, WEEX API, CertiK Skynet,
   Base RPC, DefiLlama, EAS).
4. Principle: the model reads, code decides; absence of proof is never "false".
5. Concrete numbers from real runs (e.g. "checked N real announcements: X claims verified, Y contradicted").
6. Receipts: EAS on Base, verify page.
7. "Deliberately not built in v1" paragraph (§4).
8. Live demo link + what to click in 30 seconds.

## 20. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Same ticker, different token | Contract matching via WEEX `v3/coins` (the only exchange that exposes addresses); BingX and others give a qualified ✅, never a plain ✅ |
| Delisted market still in the symbol list | 1,581 of 2,271 BingX symbols are delisted but still returned — the status gate in §10.1 is what stops those becoming false ✅ |
| Partnership check too fuzzy | Partner-domain-only rule; unknown partner = ⚠️; never ❌ |
| FxTwitter rate limit / outage | oEmbed fallback; 24 h cache; paste-text always works |
| Tavily credits run out | CertiK is fetched by direct slug (§10.2), removing the biggest consumer; Tavily is fallback + partnership only. Cache aggressively; pre-run demo examples; student plan |
| Public Base RPC throttling | Alchemy free key in `BASE_RPC_URL` |
| Vercel 60 s limit | Parallel checkers, per-call timeouts, budget |
| LLM invents claims | Quote guard (exact substring) + Zod |
| Demo breaks during judging | Pre-computed example reports load from Redis; `/api/health` status panel |
