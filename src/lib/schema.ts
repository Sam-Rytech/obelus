/**
 * Obelus data model — architecture §8.
 *
 * Every LLM output and every external response is validated through these schemas.
 * The core principle (§3) is encoded here in one place: a Verdict is produced only by
 * a deterministic checker, and always travels with the Evidence that decided it.
 */
import { z } from "zod";

export const ClaimType = z.enum([
  "EXCHANGE_LISTING",
  "AUDIT",
  "OWNERSHIP_RENOUNCED",
  "LIQUIDITY_LOCK",
  "PARTNERSHIP",
  "TVL",
  "OTHER",
]);
export type ClaimType = z.infer<typeof ClaimType>;

export const Claim = z.object({
  id: z.string(), // "c1", "c2", ...
  type: ClaimType,
  /**
   * Exact span from the input text. The quote guard (§8) drops any claim whose quote
   * is not a substring of the input — this is what stops the model inventing claims.
   */
  quote: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type Claim = z.infer<typeof Claim>;

/**
 * Per-type `params` shapes. The router validates a claim against its own schema
 * before handing it to a checker, so a checker never sees params it cannot read.
 */
export const ClaimParams = {
  EXCHANGE_LISTING: z.object({
    exchange: z.string(),
    market: z.enum(["spot", "futures"]).optional(),
    /** Set by the extractor for "will list" wording; reinforced by the status gate (§10.1). */
    tense: z.enum(["present", "future"]).optional(),
  }),
  AUDIT: z.object({ auditor: z.string() }),
  OWNERSHIP_RENOUNCED: z.object({}),
  LIQUIDITY_LOCK: z.object({
    durationText: z.string().optional(),
    locker: z.string().optional(),
  }),
  PARTNERSHIP: z.object({ partner: z.string() }),
  TVL: z.object({ amountUsd: z.number(), asOfText: z.string().optional() }),
  OTHER: z.object({}),
} as const satisfies Record<ClaimType, z.ZodType>;

export const EvmAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte address");

export const Project = z.object({
  name: z.string().optional(),
  ticker: z.string().optional(),
  contract: EvmAddress.optional(),
  /**
   * "stated": copied from the announcement. "resolved": inferred by Obelus via
   * DexScreener. Only a stated contract may produce DIFFERENT_TOKEN_SAME_TICKER —
   * an inference that picked a same-ticker clone must not stamp the project ❌.
   */
  contractSource: z.enum(["stated", "resolved"]).optional(),
  chain: z.literal("base").default("base"),
});
export type Project = z.infer<typeof Project>;

/**
 * §3: absence of proof is UNVERIFIED, never CONTRADICTED. CONTRADICTED requires a
 * primary source that positively says otherwise.
 */
export const Verdict = z.enum(["VERIFIED", "CONTRADICTED", "UNVERIFIED"]);
export type Verdict = z.infer<typeof Verdict>;

export const Evidence = z.object({
  source: z.string(), // "WEEX public API", "CertiK Skynet", "Base RPC", ...
  url: z.url(), // what a human can open to check
  fetchedAt: z.iso.datetime(),
  excerpt: z.string(), // the exact data that decided the verdict (trimmed)
});
export type Evidence = z.infer<typeof Evidence>;

export const CheckResult = z.object({
  claimId: z.string(),
  verdict: Verdict,
  /** e.g. "Ticker listed — contract unconfirmed", "Proxy: upgradeable". */
  qualifier: z.string().optional(),
  reason: z.string(), // deterministic reason code + short text
  evidence: z.array(Evidence),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const InputKind = z.enum(["x", "url", "text"]);

export const Report = z.object({
  id: z.string(), // short id for /r/[id]
  input: z.object({
    kind: InputKind,
    value: z.string(),
    fetchedText: z.string(),
  }),
  project: Project,
  claims: z.array(Claim),
  results: z.array(CheckResult),
  /** LLM plain-English prose. It may not contain a verdict that is not in `results`. */
  summary: z.string(),
  trace: z.array(z.object({ t: z.iso.datetime(), step: z.string() })),
  engineVersion: z.string(), // git short sha
  createdAt: z.iso.datetime(),
  reportHash: z.string(), // keccak256 of canonical JSON (§11)
  /** Excluded from reportHash (§11), so adding it after the fact never changes the fingerprint. */
  attestation: z
    .object({
      uid: z.string(),
      txHash: z.string(),
      /** Which network holds the receipt. Absent on receipts written before testnet support = mainnet. */
      chain: z.enum(["base", "base-sepolia"]).optional(),
    })
    .optional(),
});
export type Report = z.infer<typeof Report>;

/**
 * Deterministic reason codes. Checkers return one of these plus short text, so the
 * report never carries free-form model prose in the place a verdict is justified.
 */
export const REASON = {
  // EXCHANGE_LISTING (§10.1)
  EXCHANGE_NOT_SUPPORTED: "EXCHANGE_NOT_SUPPORTED",
  NOT_IN_EXCHANGE_MARKET_LIST: "NOT_IN_EXCHANGE_MARKET_LIST",
  MARKET_DELISTED: "MARKET_DELISTED",
  MARKET_NOT_LIVE: "MARKET_NOT_LIVE",
  UNKNOWN_MARKET_STATUS: "UNKNOWN_MARKET_STATUS",
  DIFFERENT_TOKEN_SAME_TICKER: "DIFFERENT_TOKEN_SAME_TICKER",
  FUTURE_CLAIM: "FUTURE_CLAIM",
  LISTED_CONTRACT_UNCONFIRMED: "LISTED_CONTRACT_UNCONFIRMED",
  LISTED_CONTRACT_MATCHES: "LISTED_CONTRACT_MATCHES",
  // AUDIT (§10.2)
  AUDITOR_NOT_IN_REGISTRY: "AUDITOR_NOT_IN_REGISTRY",
  AUDITOR_PAGE_SAYS_NOT_AUDITED: "AUDITOR_PAGE_SAYS_NOT_AUDITED",
  NO_AUDITOR_RECORD_FOUND: "NO_AUDITOR_RECORD_FOUND",
  AUDIT_RECORD_FOUND: "AUDIT_RECORD_FOUND",
  // OWNERSHIP_RENOUNCED (§10.3)
  NO_OWNER_FUNCTION: "NO_OWNER_FUNCTION",
  OWNER_IS: "OWNER_IS",
  OWNER_RENOUNCED: "OWNER_RENOUNCED",
  RENOUNCED_BUT_UPGRADEABLE: "RENOUNCED_BUT_UPGRADEABLE",
  // LIQUIDITY_LOCK (§10.4)
  LP_LOCKED: "LP_LOCKED",
  LP_PARTIALLY_LOCKED: "LP_PARTIALLY_LOCKED",
  LP_NOT_IN_KNOWN_LOCKER: "LP_NOT_IN_KNOWN_LOCKER",
  LP_HELD_BY_EOA: "LP_HELD_BY_EOA",
  LOCK_TYPE_NOT_SUPPORTED_V1: "LOCK_TYPE_NOT_SUPPORTED_V1",
  // PARTNERSHIP (§10.5)
  PARTNER_NOT_IN_REGISTRY: "PARTNER_NOT_IN_REGISTRY",
  PARTNER_CONFIRMED: "PARTNER_CONFIRMED",
  /** The partner's site names the project, but not in partnership terms (e.g. a price feed). */
  MENTION_ONLY: "MENTION_ONLY",
  NO_PARTNER_CONFIRMATION: "NO_PARTNER_CONFIRMATION",
  // TVL (§10.6)
  TVL_WITHIN_TOLERANCE: "TVL_WITHIN_TOLERANCE",
  TVL_OUTSIDE_TOLERANCE: "TVL_OUTSIDE_TOLERANCE",
  NOT_ON_DEFILLAMA: "NOT_ON_DEFILLAMA",
  // general (§18)
  NOT_CHECKABLE_V1: "NOT_CHECKABLE_V1",
  NO_CONTRACT_RESOLVED: "NO_CONTRACT_RESOLVED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  SOURCE_ERROR: "SOURCE_ERROR",
} as const;
export type Reason = (typeof REASON)[keyof typeof REASON];
