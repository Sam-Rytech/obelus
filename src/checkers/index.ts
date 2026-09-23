/**
 * Router: ClaimType -> checker — architecture §5 step 4, §17.
 *
 * Every claim type has exactly one deterministic checker. OTHER is shown in the report
 * as UNVERIFIED NOT_CHECKABLE_V1 — transparency over silence (§10.7).
 */
import { REASON, type ClaimType } from "../lib/schema";
import { checkAudit } from "./audit";
import { checkExchangeListing } from "./exchange/index";
import { checkLock } from "./lock";
import { checkOwnership } from "./ownership";
import { checkPartnership } from "./partnership";
import { checkTvl } from "./tvl";
import { result, type Checker } from "./types";

const checkOther: Checker = async (claim) =>
  result(
    claim,
    "UNVERIFIED",
    `${REASON.NOT_CHECKABLE_V1} — this kind of claim has no primary source Obelus can check yet`,
    [],
    "Not checkable in v1",
  );

export const CHECKERS: Record<ClaimType, Checker> = {
  EXCHANGE_LISTING: checkExchangeListing,
  AUDIT: checkAudit,
  OWNERSHIP_RENOUNCED: (claim, project, ctx) => checkOwnership(claim, project, ctx),
  LIQUIDITY_LOCK: checkLock,
  PARTNERSHIP: checkPartnership,
  TVL: checkTvl,
  OTHER: checkOther,
};
