/**
 * Exchange router — architecture §10.1 step 1.
 *
 * Resolves the exchange name the model read out of the announcement against the
 * registry, then dispatches to that exchange's adapter. An unknown exchange is not an
 * error: it returns UNVERIFIED EXCHANGE_NOT_SUPPORTED, because we have no primary
 * source for it and absence of a source is never disproof (§3).
 */
import { findExchange } from "../../registry/index";
import { REASON, type Claim, type Project } from "../../lib/schema";
import { result, type Ctx } from "../types";
import { checkBingx } from "./bingx";
import { DIRECT_EXCHANGES, makeDirectChecker } from "./direct";
import { checkWeex } from "./weex";

export async function checkExchangeListing(claim: Claim, project: Project, ctx: Ctx) {
  const name = typeof claim.params.exchange === "string" ? claim.params.exchange : "";
  const entry = findExchange(name);

  if (!entry) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.EXCHANGE_NOT_SUPPORTED} — "${name || "unnamed exchange"}" is not in the registry, so Obelus has no primary source for it`,
      [],
      "Exchange not supported in v1",
    );
  }

  if (!project.ticker) {
    return result(
      claim,
      "UNVERIFIED",
      `${REASON.NOT_IN_EXCHANGE_MARKET_LIST} — no ticker was stated, so there is nothing to look up on ${entry.id}`,
      [],
      "No ticker in the announcement",
    );
  }

  ctx.trace.step(`Checking ${entry.names[0]} listing for ${project.ticker}`);

  if (entry.checker === "weex") return checkWeex(claim, project, ctx);
  if (entry.checker === "bingx") return checkBingx(claim, project, ctx);
  if (entry.checker === "direct" && DIRECT_EXCHANGES[entry.id]) {
    return makeDirectChecker(entry.id)(claim, project, ctx);
  }

  return result(
    claim,
    "UNVERIFIED",
    `${REASON.EXCHANGE_NOT_SUPPORTED} — ${entry.names[0]} has no fast public endpoint; its CCXT adapter exceeds the per-request budget`,
    [],
    "Exchange not supported in v1",
  );
}
