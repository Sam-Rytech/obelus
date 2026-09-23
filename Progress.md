# Obelus — Progress

**Project:** Obelus — fact-checker for crypto announcements (see `architecture.md`)
**Hackathon:** Orion Builder Hackathon (Orion Agents, Base) — registered as **Sam_rytech**
**Hard deadline:** Sep 27, 2026, 23:59 UTC = **Sep 28, 00:59 Lagos**
**Target submission:** **Sat Sep 26** (27th is buffer only)

---

## How to use this file (for Sam + Claude Code)

1. Claude Code reads `architecture.md` and this file at the start of every session.
2. Work **one task at a time**, top to bottom. Tick `[x]` when the acceptance check passes.
3. After **every** change: `pnpm typecheck` (and `pnpm test` once tests exist). Don't move on while red.
4. Read a file before editing it. Only fix what was introduced in the current session.
5. Environment: Windows + Git Bash (MINGW64); Codespaces uses Linux bash. Write files with the editor tools;
   avoid bash heredocs.
6. Log every decision in **Decision log** and every blocker in **Blockers** (bottom of file).
7. If a spike shows an endpoint doesn't work as documented, **stop, log it, and adjust the plan** — don't guess.

---

## Day 0 — Tue Sep 22: accounts & keys (Sam, ~1 h)

- [x] GitHub repo `obelus` under Sam-Rytech — created **private** Sep 22 at Sam's request. **Must be made public before submission** (Orion requires a public repo)
- [ ] X account for the project (e.g. @ObelusCheck) — bio + link placeholder
- [ ] Telegram: create bot with @BotFather → `TELEGRAM_BOT_TOKEN`; create a public channel/group for the project link
- [ ] Vercel account linked to GitHub
- [ ] Anthropic API key (add ~$5–10 credit) → `ANTHROPIC_API_KEY` — **key set and authenticates, but the account has no credit** (API returns 400 "credit balance is too low"). Buy credits under Plans & Billing
- [x] Tavily key (free, 1,000 credits/mo) → `TAVILY_API_KEY` — verified live Sep 23. Optional: apply for the student plan (email support@tavily.com from student email — covers hackathons)
- [x] Upstash Redis (free) → REST URL + token — verified live through `cache.ts` Sep 23
- [ ] Alchemy (free) Base mainnet RPC URL → `BASE_RPC_URL` (fallback: `https://mainnet.base.org`)
- [ ] **New** wallet for attestations (NOT the registered wallet) → fund with ~$2 of ETH on Base → `ATTESTER_PRIVATE_KEY`
- [ ] Registered wallet (Sam_rytech): hold ~$12 of ETH on Base for the ignition fee

**Acceptance:** all keys in `.env.local`, `.env.local` in `.gitignore`.

---

## Day 1 — Tue 22 / Wed 23: scaffold + spikes + schema

### 1A. Scaffold
- [x] Next.js scaffold (TypeScript, App Router, Tailwind v4, root `app/` + hand-made `src/` per architecture §17). **Written by hand** — `create-next-app` hangs on an interactive prompt in this environment
- [x] Add deps: `zod viem ccxt @anthropic-ai/sdk @tavily/core @upstash/redis @upstash/ratelimit grammy @ethereum-attestation-service/eas-sdk ethers`
- [x] Dev deps: `vitest tsx`
- [x] Scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `fixture` (`tsx scripts/run-fixture.ts`)
- [x] `architecture.md` + `Progress.md` are at the repo root; `git init` done; `.gitignore` + `.env.example` written
- [x] First commit + push to GitHub — https://github.com/Sam-Rytech/obelus (private)
- [ ] Deploy empty app to Vercel — **blocked, no Vercel account** (see Blockers)

**Acceptance:** `pnpm typecheck` passes ✅ (Vercel URL pending).

### 1B. Verification spikes (scripts in `scripts/spike-*.ts`, run with `pnpm tsx`)
Each spike prints the raw response shape and writes a note in **Spike results** below.
- [x] `spike-bingx.ts` — `GET https://open-api.bingx.com/openApi/spot/v1/common/symbols` → confirm fields (symbol, status). Find whether any public BingX endpoint exposes **contract addresses / networks** per coin. Check futures contracts endpoint (`/openApi/swap/v2/quote/contracts`).
- [x] `spike-weex.ts` — `GET https://api-spot.weex.com/api/v2/public/products` and `api/v3/coins` → confirm fields; look for contract addresses.
- [x] `spike-ccxt.ts` — `loadMarkets()` + `fetchCurrencies()` for binance, bybit, okx, gate, mexc, kucoin, bitget → which expose contract addresses per network?
- [x] `spike-certik.ts` — Tavily search `include_domains: ["skynet.certik.com"]` for 3 projects → fetch page → confirm "Code Audit History" / "Not Audited By CertiK" parse.
- [x] `spike-fxtwitter.ts` — fetch 2 real tweets via `api.fxtwitter.com`; then the oEmbed fallback.
- [x] `spike-dexscreener.ts` — find Base pairs for a known Base token; record exact endpoint + fields (pairAddress, dexId, liquidity, labels v2/v3).
- [x] `spike-lockers.ts` — from **UNCX and Team Finance official docs**, get their **Base** locker contract addresses; record docs URLs; call `balanceOf` on one known locked LP.
- [x] `spike-defillama.ts` — `/protocols` → confirm name/slug/tvl fields.
- [x] `spike-eas.ts` — connect to EAS `0x4200…0021` on Base, read a known attestation.

**Acceptance:** every spike result logged below; plan adjusted for anything that failed.

### 1C. Core types
- [x] `src/lib/schema.ts` exactly as architecture §8
- [x] `src/lib/trace.ts`, `budget.ts`, `cache.ts` (Redis get/set with TTL, in-memory fallback when unset)
- [x] `src/registry/index.ts` — Zod schemas + case/punctuation-insensitive lookup; unknown name → `null`, never an error
- [x] `exchanges.json` (9 entries, each flagged `canConfirmContract` from the spikes)
- [x] `lockers.base.json` (2 UNCX entries, docs-sourced **and** code-verified on Base)
- [x] `auditors.json` — CertiK only so far
- [x] `partners.json` — top 15, **every domain verified live** by `scripts/verify-domains.ts` (19/21 reachable; Coinbase is DNS-blocked from this network and carries an explicit note instead of a verification date). Unknown partners still return UNVERIFIED `PARTNER_NOT_IN_REGISTRY`
- [ ] `auditors.json`: auditors beyond CertiK (hacken, slowmist, peckshield, …) — deferred to Day 3 alongside `checkers/audit.ts`, which is what consumes them
- [x] `tests/registry.test.ts` — 9 tests, incl. an assertion that the undeployed UNCX address stays out

**Acceptance:** `pnpm typecheck` green ✅; `pnpm test` 9/9 ✅; registries load and validate with Zod ✅.

---

## Day 2 — Wed Sep 23: ingest + extract + first checkers

- [x] `ingest/text.ts`, `ingest/url.ts` (SSRF guard with per-redirect re-validation, 10 s timeout, 2 MB cap), `ingest/x.ts` (FxTwitter → oEmbed), `ingest/index.ts` (input detection)
- [x] `llm.ts` adapter (Anthropic; model from `LLM_MODEL`; `StubLlm` so extraction is testable with no key)
- [x] `extract.ts` — Zod validation, **quote guard**, per-type param validation, de-duplication, id renumbering, and a contract address discarded unless it appears in the source
- [x] `checkers/exchange/` — `market.ts` (pure verdict rules), `weex.ts`, `bingx.ts`, `direct.ts` (Binance/Bybit/OKX/MEXC), `index.ts` router. **`ccxt.ts` replaced by `direct.ts`** — CCXT is too slow for the live path
- [x] `checkers/ownership.ts` (§10.3) incl. EIP-1967 proxy detection and the renounced-but-upgradeable case
- [x] `scripts/run-fixture.ts` — runs ingest → extract → check from the CLI; falls back to offline claim detection with no API key, so the checkers still run against live sources
- [x] Tests: `exchange.test.ts` (13), `exchange.direct.test.ts` (14), `ownership.test.ts` (10), `extract.quoteguard.test.ts` (18), `registry.test.ts` (13) — **68 passing**

**Acceptance:** ✅ `pnpm fixture fixtures/sample1.txt` prints extracted claims and real verdicts — WEEX returns an unqualified VERIFIED via a live contract match on AERO.

---

## Day 3 — Thu Sep 24: remaining checkers + pipeline + API

- [x] `checkers/audit.ts` (§10.2) — CertiK by direct slug (VERIFIED needs "N Audits available", N ≥ 1) with name-matched Tavily fallback; 10 more auditors via search, requiring audit wording (a hack post-mortem must not verify)
- [x] `checkers/partnership.ts` (§10.5) — name + partnership wording in the same sentence, `MENTION_ONLY` otherwise, never CONTRADICTED
- [x] `checkers/tvl.ts` (§10.6) — `/tvl/<slug>`, floor wording, name variants that can verify but not contradict
- [x] `checkers/lock.ts` (§10.4) — v2-style LP only, one Multicall3 read
- [x] `resolve.ts` — DexScreener resolution only when unambiguous; resolved contracts can't produce `DIFFERENT_TOKEN_SAME_TICKER`
- [x] `pipeline.ts` — parallel checks, 12-call budget, per-claim 20 s timeout, every claim guaranteed a result
- [x] `hash.ts` — canonical JSON + keccak256, isomorphic for the verify page
- [x] `summary.ts` — built by code from results (deviation from §5, see Decision log)
- [x] `store.ts`, `ratelimit.ts` — Upstash, 90-day report TTL, 10 checks/IP/hour
- [x] `app/api/check/route.ts` — SSE trace stream → `{ reportId }`
- [x] `app/api/report/[id]/route.ts` — 400 bad id / 404 missing / 503 storage down
- [x] Tests for audit, partnership, tvl, lock, hash, pipeline, resolve, summary — **148 passing**

**Acceptance:** ✅ with one exception. `curl -N -X POST /api/check` streams the trace and returns clean error events (SSRF refused, bad input rejected); `GET /api/report/<id>` serves a stored report whose hash recomputes to a match. The *full* real-announcement run through `/api/check` waits on Anthropic credit — the same pipeline runs end to end with `pnpm fixture fixtures/sample1.txt --offline --save` (8 claims, 8/12 source calls, 7.3 s).

---

## Day 4 — Fri Sep 25: UI + Telegram + receipts + deploy

- [x] `app/page.tsx` — "scholar's margin" design (Sam's pick): input, live trace as margin notes, labelled test example
- [x] `app/r/[id]/page.tsx` — claims with margin sigla (※ verified, ÷ contradicted, ? unverified), ink stamps, qualifiers, proof, summary, trace, receipt, share; §15 test label
- [x] `app/method/page.tsx` — how each claim is checked, the marks, v1 limits, live source status
- [x] `src/lib/eas.ts` + `anchor.ts` — attest via viem after the response (`after()`), receipt written back to the report; "receipt pending" fallback
- [x] `scripts/register-schema.ts` — dry-run by default; schema UID `0xd10de7a2…ac4ac05` (not yet registered)
- [x] Receipts switchable to **Base Sepolia** for testing (`EAS_CHAIN`); checkers stay on mainnet. Production currently writes to Sepolia
- [x] Schema registered on **Base Sepolia** ([tx](https://sepolia.basescan.org/tx/0x733647a204c38af012349bf5732fbc07a948fe7bba0cb9be37cb48683730930f)); `EAS_SCHEMA_UID` set on Vercel
- [x] **Receipt chain proven in production**: report `VpM53187xm` attested on Sepolia; the live verify page passed all three checks, and after one verdict was flipped in Redis it flagged both the fingerprint and the on-chain mismatch (then restored). `scripts/attest-report.ts` attests any stored report
- [ ] Switch receipts to **Base mainnet** (~$2 ETH, `EAS_CHAIN=base`, register once more) before the demo
- [x] `app/r/[id]/verify/page.tsx` — re-hashes in the browser and reads EAS on Base directly (public RPC allows CORS)
- [x] `src/bot/telegram.ts` + `app/api/telegram/route.ts` + `scripts/set-webhook.ts` — replies "Checking…", finishes in `after()`, edits the message
- [x] Telegram live — **@Obelus_the_Bot**, webhook set to production with a secret (unsigned requests get 401). `/check` replies with an error until Anthropic credit lands
- [x] `app/api/health/route.ts` + status panel on /method
- [x] Production deploy — **https://obelus-five.vercel.app**, env vars set (secrets marked sensitive), `maxDuration` 60 on `/api/check` and `/api/telegram`
- [x] Tests: `eas.test.ts`, `telegram.test.ts` — **162 passing**

**Acceptance:** partly. The site, report and verify pages, API and health panel work in production, and every data source answers from Vercel. The full phone test (paste → report → EAS link → verify ✅) and `/check` in Telegram wait on three things from Sam: Anthropic credit, funding the attester wallet, and a bot token.

---

## Day 5 — Sat Sep 26: demo content, polish, SUBMIT

- [ ] Run Obelus on 15–30 real announcements (PR wires, X posts about Base tokens); record totals for the description (claims checked / verified / contradicted / unverified)
- [ ] Pick Example A (real, clean), Example B (real, mixed), Example C (**labeled** test announcement) — pre-run, pin on home page
- [ ] README: what it is, how it works, sources table, principle, "not built in v1", run locally, env vars, architecture diagram
- [ ] Demo video 2–3 min: problem (20 s) → paste live → stamps + BingX/WEEX proof (60 s) → receipt on Base (20 s) → Telegram `/check` (20 s) → what's next (20 s). 720p+. Upload to YouTube (unlisted is fine)
- [ ] X profile: pinned post with video + link. Telegram channel: pinned link
- [ ] Clean-browser dry run of the demo link
- [ ] Write submission description (architecture §19 structure)
- [ ] **Submit from the registered wallet; pay ignition fee (~$10 ETH)**
- [ ] Post in Orion community channels + X; ask network to upvote

**Acceptance:** entry visible in the Orion gallery with working demo link.

## Sun Sep 27 — buffer only
- [ ] Fix only what breaks. No new features.

---

## Deliverables checklist (Orion rules)
- [ ] Website (Vercel URL)
- [ ] X profile
- [ ] GitHub repo (public, README)
- [ ] Telegram link
- [ ] Demo link (optional but judges try what they can run)
- [ ] Demo video
- [ ] Submitted from registered wallet, ignition fee paid

---

## Cut list (if behind schedule, cut in this order)
1. Verify page (keep EAS link only)
2. LIQUIDITY_LOCK checker
3. CCXT exchanges (keep BingX + WEEX)
4. TVL checker
5. Telegram bot (keep website) — **last resort**; the rules require a Telegram/Discord *link*, not a bot

Never cut: extraction + quote guard, BingX/WEEX listing checks, audit check, ownership check, report page, EAS receipt.

---

## Spike results
_(fill in during Day 1B — endpoint, what worked, response fields, surprises)_

All run Sep 22. Each has a reproducible script in `scripts/spike-*.ts` (`pnpm spike scripts/spike-x.ts`)
that re-asserts its finding, so they double as regression tests if an upstream changes mid-hackathon.

| Spike | Result | Notes |
|---|---|---|
| BingX | Works, but the status gate is mandatory | 2,271 symbols: status 1=live (643), 0=not live (1,581, of which 1,229 have a past `offTime` = provably delisted), 10=announced (41), 5/25=6. **Gate on `status` alone** — `offTime` and `apiStateBuy` are both unreliable (18 live symbols carry a past `offTime`; 1,302 of 1,581 not-live symbols still report `apiStateBuy: true`). List also contains 31 `TEST*` symbols. **No contract address on any public endpoint** (spot, futures; `capital/config/getall` needs a key) → BingX ✅ is always qualified. |
| WEEX | Works — and is the primary listing checker | Use **`v3/exchangeInfo`** (3,508 symbols, `baseAsset`/`quoteAsset`/`status` TRADING 2,454 / HALT 1,054), **not** `v2/public/products` (bare strings like `MRVLONUSDT_SPBL`, base/quote undecidable). **`v3/coins` exposes `contractAddress`** per network (467/3,971 coins; **42 on BASE**). AERO→BASE matches DexScreener exactly. Only public exchange source that can catch `DIFFERENT_TOKEN_SAME_TICKER`. |
| CCXT | 3/7 can confirm a Base contract | Confirm on Base: gate (154 coins), kucoin (79), bitget (66). Ticker-only: binance, bybit, okx, mexc (no currency networks at all). **Only `BASE`-keyed networks may enter a verdict** — bitget exposes an address for 3,993 of 5,059 coins, but mostly on other chains; matching those would manufacture a false `DIFFERENT_TOKEN_SAME_TICKER`. |
| CertiK | Works by direct slug — Tavily not needed | Server-rendered, no CF block. `__NEXT_DATA__` is obfuscated and holds no audit data. **Discriminator is the "Not Audited By CertiK" badge, NOT "Code Audit History"** — that is a static heading on every page, audited or not. 404 → UNVERIFIED (no parsing needed). Verified across 5 slugs covering all three verdicts: pancakeswap/polygon ✅, uniswap/aerodrome-finance ❌, nonexistent → 404. |
| FxTwitter / oEmbed | Works | `{ code, message, tweet{ text, raw_text, author, created_at, lang, ... } }`; typed JSON on failure. **`/i/status/<id>` works without the username**, so ingest only needs the id. oEmbed: `publish.twitter.com` 301s to **`publish.x.com`**; pass `omit_script=1`, recover text from the blockquote. Cache both 24 h. |
| DexScreener | Works | `/latest/dex/search?q=` → `chainId`, `dexId`, `pairAddress`, `baseToken.address`, `liquidity`. 19 Base pairs for AERO. **`labels` identifies pair type**: v2-style has an empty array, concentrated liquidity is `["v3"]`/`["v4"]` — that is the §10.4 gate. |
| Lockers (Base) | 2 registered, 2 rejected; **Team Finance BLOCKED** | From [UNCX v2 docs](https://docs.uncx.network/guides/for-developers/liquidity-lockers/lockers-v2/contracts). Registered (docs-listed **and** deployed on Base): Sushiswap `0xBeddF48499788607B4c2e704e9099561ab38Aae8`, Aerodrome `0x30e522deDfFE3e3d11Cd53E27d18Cd4F016eD870`. **Rejected: UNCX's "Base (Uniswap V2)" row `0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB` has NO CODE on Base** — had it gone in unverified, every Uniswap-V2-locked project would have read as unlocked. Also rejected `0x231278edd38b00b07fbd52120cef685b9baebcc1` (target of every Base explorer link in those docs; deployed but never labelled, so its role is unconfirmed). |
| DefiLlama | Works — use `/tvl/<slug>` | **`/tvl/<slug>` = 17 B** (bare number; a miss returns `Protocol not found`) vs `/protocols` 8.9 MB and `/protocol/<slug>` 13.9 MB. Per-claim path is `/tvl`; `/protocols` only as a cached name→slug map (8,325 protocols, 876 on Base). |
| EAS | Readable, no wallet needed | EAS `0x4200…0021` and SchemaRegistry `0x4200…0020` both have code on Base; `version()` = 1.0.1; `getAttestation` decodes via viem over the public RPC (~780 ms). Writing needs `ATTESTER_PRIVATE_KEY` (Day 4). |
| Tavily | Works — `include_domains` is a hard restriction | Sep 23, `spike-tavily.ts`, ~3 credits. Every result for "Aave" on `chain.link` was on-domain. **Three findings for Day 3:** (1) Tavily *always* returns results — 5 for a fabricated project, 0 of which mention it — so `partnership.ts` must match the project name in the content; counting results would verify every claim. (2) **A mention is not a partnership:** all the Aave hits were Chainlink *price-feed pages*, so under §10.5 as written any token with a Chainlink feed would verify "partnered with Chainlink". Needs a design decision. (3) The CertiK fallback returns unrelated slugs next to the right one (`pancakeswap, four-meme, solidus-ai-tech…`), so it must pick by name. Latency 6–11 s per search from Lagos — over the 8 s ceiling. |
| Upstash Redis | Works through `cache.ts` | Sep 23, `spike-upstash.ts`. Backend auto-selected from env; objects round-trip intact; TTL applied; `cached()` served a second call from Redis across a fresh backend instance — i.e. across serverless invocations. First set+get 4.8 s cold from Lagos; place the DB in the Vercel region. |
| Exchanges (direct REST) | 2/4 verified here — **replaces CCXT** | Sep 23. CCXT measured unusable: `gate.loadMarkets()` **46.5 s** + 10.8 s `fetchCurrencies` (vs a 60 s pipeline), kucoin 4.1 s, bitget 5.0 s, binance 5.8 s (vs an 8 s per-call ceiling). Direct single-symbol REST instead: **MEXC** `api/v3/exchangeInfo?symbol=` 921 B / 171 ms warm, **Bybit** `api.bytick.com/v5/market/instruments-info` 637 B / 1.4 s warm. **Binance and OKX are DNS-blocked from this network** on every documented host (`data-api.binance.vision`, `api1`/`api-gcp.binance.com`, `api.binance.us`, `aws.okx.com`) — adapters ship with runtime shape validation so a mismatch degrades to UNVERIFIED. None of the four publishes a contract address. |
| Registry domains | 19/21 reachable | Sep 23, `scripts/verify-domains.ts`. `certik.com` times out but `www.certik.com` serves 200 — registry updated. **`coinbase.com` and `www.coinbase.com` fail DNS** from this network, same pattern as Binance/OKX; the entry carries an explicit note instead of a verification date. |

---

## Decision log
| Date | Decision | Why |
|---|---|---|
| Sep 22 | Build **Obelus** (announcement claim-checker) | Only uncontested gap after checking CA guards, poisoning checkers, vesting, KOL trackers, KOL escrow, ZK holder proofs — all already built |
| Sep 22 | Model reads, code decides; absence of proof = UNVERIFIED | Trust + matches what top-scoring entries do |
| Sep 22 | No x402, no X search, no audit-PDF parsing in v1 | Time; x402 over-represented in the field; X search locked |
| Sep 22 | EAS on Base for receipts | Predeploy on Base, explorer judges can click |
| Sep 22 | Renamed Sourced → **Obelus** | Ancient mark scholars used to flag false lines in texts = exactly the product; no crypto/web3 collision found |
| Sep 22 | **Listing checks gate on live status, not presence in the symbol list** | 1,581 of BingX's 2,271 symbols are not live but still returned. The original §10.1 would have stamped ✅ on all of them |
| Sep 22 | Gate on `status` only; ignore `offTime` and `apiStateBuy` | Measured: 18 live symbols carry a past `offTime`, and 1,302 of 1,581 not-live symbols still report `apiStateBuy: true`. Neither is safe to put in a verdict |
| Sep 22 | **WEEX is the primary listing checker, BingX secondary** | WEEX is the only public exchange API exposing contract addresses, so it is the only one that can produce an unqualified ✅ or catch `DIFFERENT_TOKEN_SAME_TICKER` — the scam case the product is pitched on |
| Sep 22 | Only `BASE`-keyed networks may be compared | Exchanges expose addresses on many chains; comparing a Base token to a BSC address would manufacture a false ❌ |
| Sep 22 | CertiK read by direct slug; Tavily demoted to fallback | Direct fetch works and returns a clean 404 on a miss. Removes the largest consumer of the 1,000-credit Tavily budget |
| Sep 22 | CertiK verdict keys off the "Not Audited By CertiK" badge | "Code Audit History" is a static heading on every project page — matching it would have verified every project, audited or not |
| Sep 22 | TVL uses `/tvl/<slug>` (17 B), not `/protocols` (8.9 MB) | `/protocols` per claim would not fit the 60 s serverless budget |
| Sep 22 | §10.4 `LP_NOT_IN_KNOWN_LOCKER` → UNVERIFIED, not CONTRADICTED | Our locker registry has two entries; stamping ❌ because a project used a locker we don't know is absence of proof, which §3 forbids. CONTRADICTED reserved for LP held by an EOA/deployer |
| Sep 22 | Registry addresses must be docs-sourced **and** verified to have code on-chain | UNCX publishes a Base Uniswap-V2 locker that is not deployed on Base. Docs alone are not sufficient provenance |
| Sep 22 | Root `app/` + hand-made `src/` (architecture §17), not `src/app/` | §17 is what every later task references; §1A's "src/ dir" was the inconsistent one |
| Sep 22 | Scaffolded Next.js by hand instead of `create-next-app` | The CLI hangs on an interactive prompt in this environment; hand-writing 8 config files is deterministic and gives exactly the §17 layout |
| Sep 23 | **Dropped CCXT from the live path; direct REST for Binance/Bybit/OKX/MEXC** | `gate.loadMarkets()` alone is 46.5 s against a 60 s pipeline limit. Direct single-symbol endpoints answer in 0.2–1.4 s. gate/kucoin/bitget become `unsupported` in v1 |
| Sep 23 | **An unreachable source must never be reported as "no market"** | Found by running the fixture: a DNS failure was rendering as "not found in Binance's list". Against an exhaustive list (MEXC) that logic would turn a network blip into CONTRADICTED — a false ❌ on a real listing. Transport failures, 5xx, empty and non-JSON bodies now return SOURCE_ERROR; a 4xx is still a genuine "no market" |
| Sep 23 | `listIsExhaustive` per exchange | Only MEXC omits delisted markets, so only MEXC can disprove a listing by absence. Encoding this per-exchange is what keeps CONTRADICTED-on-absence sound |
| Sep 23 | Extractor discards a contract address not present in the source text | §3 forbids the model inventing a source. An unquoted address would silently redirect every on-chain checker to the wrong contract |
| Sep 23 | `allowBuilds` in `pnpm-workspace.yaml`: only esbuild allowed | pnpm 11 had written unanswered placeholders there, which made **every `pnpm <script>` fail** — including `pnpm typecheck` and `pnpm test`. Default-deny: keccak, secp256k1 and bufferutil have pure-JS fallbacks and would need a C++ toolchain; ccxt's postinstall isn't needed |
| Sep 23 | `pnpm fixture` / `pnpm spike` load `.env.local` via `node --env-file-if-exists` | tsx doesn't read `.env.local` (only Next.js does), so the scripts ran as if no keys were set. `-if-exists` keeps a fresh clone working |
| Sep 23 | **Partnership = name + partnership wording in one sentence** (Sam's call) | Every Aave hit on chain.link was a price-feed page; name-on-domain would verify "partnered with Chainlink" for any token with a feed |
| Sep 23 | Same rule for non-CertiK auditors (audit wording, negation guard) | An auditor's blog names projects most often in hack post-mortems — name-on-domain would stamp "audited" ✅ on exploited projects |
| Sep 23 | CertiK VERIFIED requires "N Audits available", N ≥ 1 | The count is a positive signal; the old "badge absent + heading present" rule would verify any page that failed to render the badge |
| Sep 23 | Future-tense listing claims always UNVERIFIED `FUTURE_CLAIM` | Spec'd in §10.1 but missed in Day 2; the live run stamped "will be listed on Binance" ✅, and against MEXC's exhaustive list it would have been ❌ |
| Sep 23 | Inferred (resolved) contracts and shortened-name TVL matches can verify but never contradict | Both are Obelus's own guesses; a mismatch may be our wrong pick, not the project's lie |
| Sep 23 | Resolution never picks "highest liquidity" among same-ticker tokens | That heuristic is exactly how a well-funded clone would get chosen |
| Sep 23 | Summary built by code, not the LLM (deviation from §5) | §8 forbids verdicts in the summary that aren't in results; code guarantees it, a prompt can't. Halves model calls per report |
| Sep 23 | Tavily timeout 12 s, per-claim cap 20 s (deviation from §18's 8 s) | Tavily measured 6–11 s from Lagos; checks run in parallel so the pipeline still fits 60 s |
| Sep 23 | Cache only the fields checkers read | Upstash caps values at 1 MB; WEEX's raw 1.7 MB list failed to cache on every request and made WEEX time out |
| Sep 23 | Lock reads via one Multicall3 call; RPC client retries with backoff | Public Base RPC returns 429 beyond ~5 concurrent requests; batching didn't help |
| Sep 23 | GitHub-hosted auditor repos not registered | Domain check is by hostname, so `github.com` would let any repo speak for PeckShield or Trail of Bits |
| Sep 23 | Relative imports without `.js` | Next's webpack can't map `.js` → `.ts`; extensionless works in Next, tsc, tsx and vitest alike |
| Sep 24 | **Extraction on Gemini** (Sam's call), `gemini-3.6-flash` → `gemini-3.5-flash-lite` fallback | Anthropic org has no API credit. Compared on the test announcement: 3.6-flash 11.8 s with whole-sentence quotes, Flash-Lite 19.3 s with fragments; both 8/8 through the guard. Fallback covers the smaller free quota of newer Flash models and 503 overloads (seen on 3.8-flash); `gemini-2.5-flash` is retired for new users |
| Sep 24 | `null` optional params treated as absent | The prompt tells the model to write `null` for a missing optional field, but the schema rejected null — the first Gemini run lost every listing and TVL claim. Would have hit Anthropic too |
| Sep 24 | Test receipts on Base Sepolia before mainnet (Sam's call) | Proves registration → attestation → verify for free. Receipts record their network; testnet ones are labelled on the report |
| Sep 24 | UI direction "scholar's margin" (Sam's pick) | Verdicts as the ancient critical signs: Origen's asteriskos ※ for text attested by the source, Aristarchus's obelus ÷ for lines that don't hold up. Makes the product's name visible |
| Sep 24 | EAS via viem, not `@ethereum-attestation-service/eas-sdk` + ethers | One `attest()` call doesn't justify a second web3 stack; viem also runs in the browser for the verify page |
| Sep 24 | Receipts written in Next's `after()` | The user gets their link without waiting on gas (§11), and the serverless function stays alive until the attestation lands |
| Sep 24 | Health panel never reports a key as "up" | "Anthropic is answering" was showing while the account had no credit. Anthropic now gets a real 1-token probe; Tavily shows "set up, not called" |
| Sep 24 | Attester wallet generated locally | Key written straight to .env.local and Vercel (sensitive); only the address was ever printed |
| Sep 23 | Partner registry limited to a verified top 15, not the ~50 in §9 | Each domain must be visited first, and the partnership checker treats a partner-domain page as proof. Unknown partners return UNVERIFIED, so coverage grows later without any logic change |

---

## Blockers
| Date | Blocker | Status / resolution |
|---|---|---|
| Sep 22 | **No API keys yet** — Anthropic, Tavily, Upstash, Telegram, Alchemy | OPEN. Day 0 list below is untouched. Blocks: extraction, audit fallback + partnership (Tavily), persistence across requests (Upstash). Everything built so far runs without them; `cache.ts` falls back to in-memory |
| Sep 22 | **No Vercel account** | OPEN. Blocks the Day-1A "deploy empty app" acceptance check. Nothing else depends on it until Day 4 |
| Sep 22 | **Team Finance Base locker address not obtainable** | OPEN. `docs.team.finance` does not resolve, and no other official `team.finance` page publishes it. §9 forbids taking it from memory, so it is **not** in the registry. Effect: a Team-Finance-locked LP returns UNVERIFIED `LP_NOT_IN_KNOWN_LOCKER` — correct behaviour, not a false ❌. **To resolve:** open `docs.team.finance` in a normal browser, or open a known Team-Finance-locked Base LP on basescan and read the holder — then add it via `scripts/spike-lockers.ts` so it is code-verified before registration |
| Sep 22 | UNCX's published "Base (Uniswap V2)" locker has no code on Base | LOGGED, handled. `0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB` is excluded from the registry and asserted absent by a test. Uniswap-V2-locked projects on Base therefore read UNVERIFIED until a correct address is confirmed |
| Sep 22 | `registry.npmjs.org` is unreachable from the sandboxed shell | RESOLVED. `pnpm install` must run with the sandbox disabled; other hosts are unaffected. Large binaries also need `--fetch-timeout 600000` |
| Sep 23 | **`api.binance.com`, `www.okx.com`, `coinbase.com` fail DNS from this network** | RESOLVED Sep 24 — all four direct adapters pass `spike-exchanges-direct.ts` (Binance and OKX shapes, written from docs, confirmed correct), and from Vercel Binance answers in 55 ms, OKX in 251 ms. Earlier note: INTERMITTENT — later the same day Binance answered live checks and coinbase.com resolved (32/32 registry domains reachable), so this looks like flaky ISP DNS, not a hard block. OKX still unconfirmed. Every documented alternate host also fails (`data-api.binance.vision`, `api1`/`api-gcp.binance.com`, `api.binance.us`, `aws.okx.com`). Bybit works via `api.bytick.com`. The Binance/OKX adapters ship with runtime shape validation, so a wrong shape degrades to UNVERIFIED rather than a wrong verdict. **To resolve:** run `pnpm spike scripts/spike-exchanges-direct.ts` and `scripts/verify-domains.ts` from Vercel once deployed, or from a different network/mobile data |
| Sep 23 | **Anthropic account has no credit** | WORKED AROUND Sep 24 — extraction moved to Gemini's free tier. Anthropic stays selectable via `LLM_PROVIDER=anthropic` if credit is added. Original note: Re-confirmed Sep 24 with raw calls: `GET /v1/models` → 200 (key valid, lists claude-sonnet-5), `POST /v1/messages` → 400 "credit balance is too low" on org `c6416967-254c-4186-9da6-7d395f02c2c7` for every model. A Claude.ai subscription does not fund the API. The key is valid (auth passes; a bad key would be 401), but every call returns 400 "credit balance is too low". Blocks live extraction only; everything else runs. Buy credits under console.anthropic.com → Plans & Billing |
| Sep 23 | Sandboxed dev server can't make outbound TLS calls | ENVIRONMENT ONLY. The Claude preview tool runs the server in a sandbox whose TLS interception breaks Upstash and Anthropic ("unable to verify the first certificate"). Run `pnpm start` normally — outside the sandbox everything works |
| Sep 23 | BingX served 0-byte responses for ~15 min | TRANSIENT, self-healing. Reproduced across user-agents and with no UA, ~12 s then empty; the same endpoint worked earlier the same day. The checker fails closed with `SOURCE_ERROR:bingx`, and the 10-minute cache means one success covers many requests. Watch it before the demo |

---

## Status
**Current phase:** Day 4 complete and live end to end — **https://obelus-five.vercel.app**.

**Done Sep 24:** web UI, report/verify/method pages, EAS receipts (proven on Base Sepolia, including
tamper detection), @Obelus_the_Bot on Telegram, health panel, and — with extraction moved to Gemini —
the first fully live checks. 178 tests.

**Still open — Sam:** receipts to Base **mainnet** (~$2 ETH to `0x1027Ab454ef4a85271e997957a2a0A12d059F46C`,
then `EAS_CHAIN=base` and one registration); X account; public Telegram channel; make the repo public;
~$12 in the registered wallet for the ignition fee. Nice to have: Alchemy RPC URL, Team Finance locker.

**Next task — build:** Day 5 — run Obelus on 15–30 real announcements, pick Examples A and B (pre-run and
pinned), README, demo-video script, submission text.
