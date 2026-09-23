/**
 * Shared listing-verdict logic — architecture §10.1.
 *
 * Every exchange adapter reduces its own API to the same `MarketLookup`, and this one
 * function turns that into a verdict. Keeping the decision in a single pure function
 * means the rule can be tested exhaustively without a network, and means a new
 * exchange cannot accidentally invent its own semantics.
 *
 * The two rules that matter most, both learned from measurement on Sep 22:
 *
 *  1. PRESENCE IS NOT LISTING. 1,581 of BingX's 2,271 symbols are not live but are
 *     still returned by the API. A live status is required for VERIFIED.
 *  2. ABSENCE ONLY DISPROVES IF THE LIST IS EXHAUSTIVE. MEXC omits delisted markets,
 *     so "not in MEXC's list" is real evidence. For an exchange that keeps delisted
 *     entries, or where we don't know, absence stays UNVERIFIED (§3).
 */
import { REASON, type CheckResult, type Claim, type Evidence } from "../../lib/schema";
import { result } from "../types";

/** What every exchange adapter must produce, whatever its API looks like. */
export type MarketLookup = {
  exchangeLabel: string;
  endpointUrl: string;
  /** null when the exchange lists no market with this base asset at all. */
  market: {
    symbol: string;
    base: string;
    quote: string;
    /** Raw status value, quoted verbatim in the evidence excerpt. */
    rawStatus: string;
    state: "live" | "delisted" | "announced" | "unknown";
    /** Human detail for the qualifier, e.g. a delisting date. */
    detail?: string;
  } | null;
  /**
   * Base-chain contract address the exchange publishes for this asset, if any.
   * Only WEEX, gate, kucoin and bitget publish one; BingX and the rest never do.
   */
  contractOnBase?: string | null;
  /** True only if the exchange omits delisted markets from its list entirely. */
  listIsExhaustive: boolean;
};

export function decideListing(
  claim: Claim,
  lookup: MarketLookup,
  projectContract: string | undefined,
  extraEvidence: Evidence[] = [],
  contractSource: "stated" | "resolved" = "stated",
): CheckResult {
  const { exchangeLabel, endpointUrl, market } = lookup;
  const ev = extraEvidence;

  // --- "Will list" is about the future, which no market list can confirm or refute.
  // Without this, "will list on MEXC next month" plus MEXC's exhaustive list would come
  // back CONTRADICTED — absence is exactly what a genuine future listing looks like.
  // Found in the first live run (Sep 23): a future Binance claim was stamped ✅.
  if (claim.params.tense === "future") {
    const now =
      market?.state === "live"
        ? `Already trading on ${exchangeLabel} (${market.symbol})`
        : market
          ? `On ${exchangeLabel} with status ${market.rawStatus}, not trading`
          : `Not on ${exchangeLabel} yet`;
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.FUTURE_CLAIM} — the announcement describes a future listing; ${now.charAt(0).toLowerCase()}${now.slice(1)}`,
      ev,
      `Future claim — ${now}`,
    );
  }

  // --- No market with that base asset --------------------------------------------
  if (!market) {
    if (lookup.listIsExhaustive) {
      return result(
        claim,
        "CONTRADICTED",
        `${REASON.NOT_IN_EXCHANGE_MARKET_LIST} — no market for this ticker in ${exchangeLabel}'s full symbol list`,
        ev,
      );
    }
    // The list may retain delisted entries, so absence is not proof of never-listed.
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NOT_IN_EXCHANGE_MARKET_LIST} — not found in ${exchangeLabel}'s list, which is not known to be exhaustive`,
      ev,
    );
  }

  const where = `${market.symbol} on ${exchangeLabel} (status ${market.rawStatus})`;

  // --- Market exists but is not live ----------------------------------------------
  if (market.state === "delisted") {
    return result(
      claim,
      "CONTRADICTED",
      `${REASON.MARKET_DELISTED} — ${where}`,
      ev,
      market.detail ? `Delisted: ${market.detail}` : "Market is delisted",
    );
  }

  if (market.state === "announced") {
    // The exchange's own data says "not yet" — stronger than the extractor's tense flag.
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.FUTURE_CLAIM} — ${where} is listed but not yet trading`,
      ev,
      "Announced, not trading yet",
    );
  }

  if (market.state === "unknown") {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.UNKNOWN_MARKET_STATUS} — ${where}`,
      ev,
      "Market status could not be interpreted",
    );
  }

  // --- Market is live: does the token identity match? -----------------------------
  const listed = lookup.contractOnBase?.toLowerCase();
  const claimed = projectContract?.toLowerCase();

  if (listed && claimed) {
    if (listed === claimed) {
      return result(claim, "VERIFIED", `${REASON.LISTED_CONTRACT_MATCHES} — ${where}`, ev);
    }
    // If WE inferred the contract, the mismatch may be our wrong guess (a same-ticker
    // clone on DexScreener), not the project's lie. That is not proof of anything.
    if (contractSource === "resolved") {
      return result(
        claim,
        "UNVERIFIED",
        `${REASON.LISTED_CONTRACT_UNCONFIRMED} — ${where}; ${exchangeLabel} lists ${listed}, which differs from the contract Obelus inferred (${claimed}) because the announcement stated none`,
        ev,
        "Ticker listed — could not confirm it is this project's token",
      );
    }
    // The scam case: right ticker, different token (§20).
    return result(
      claim,
      "CONTRADICTED",
      `${REASON.DIFFERENT_TOKEN_SAME_TICKER} — ${exchangeLabel} lists ${listed} for this ticker, the announcement is about ${claimed}`,
      ev,
      `Same ticker, different token: ${exchangeLabel} lists ${listed}`,
    );
  }

  // Live, but nobody can confirm WHICH token. Never a plain ✅ (§20).
  const why = !lookup.contractOnBase
    ? `${exchangeLabel} publishes no contract address for this asset`
    : "the announcement did not state a contract address";
  return result(
    claim,
    "VERIFIED",
    `${REASON.LISTED_CONTRACT_UNCONFIRMED} — ${where}; ${why}`,
    ev,
    "Ticker listed — contract unconfirmed",
  );
}

export { REASON };
