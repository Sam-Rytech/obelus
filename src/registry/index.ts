/**
 * Registries — architecture §9. These are the backbone of "primary source": they map
 * a name the model read out of an announcement onto the one domain or endpoint that
 * can confirm it.
 *
 * Two rules govern every entry, and both exist because a wrong entry produces a wrong
 * stamp on someone's project:
 *   1. Nothing goes in from memory. Auditor and partner domains are visited first;
 *      locker addresses come from official docs, with the docs URL stored alongside.
 *   2. An address is additionally verified to have code on the chain before it is
 *      admitted. On Sep 22 this caught UNCX's published "Base (Uniswap V2)" locker,
 *      which is not deployed on Base at all (see scripts/spike-lockers.ts).
 *
 * An unknown name is never an error — it resolves to null and the checker returns
 * UNVERIFIED with a *_NOT_IN_REGISTRY reason, per §3.
 */
import { z } from "zod";

import auditorsJson from "./auditors.json" with { type: "json" };
import exchangesJson from "./exchanges.json" with { type: "json" };
import lockersJson from "./lockers.base.json" with { type: "json" };
import partnersJson from "./partners.json" with { type: "json" };
import { EvmAddress } from "../lib/schema.js";

export const ExchangeEntry = z.object({
  id: z.string(),
  names: z.array(z.string()).min(1),
  checker: z.enum(["weex", "bingx", "ccxt"]),
  /** Whether this exchange publishes a Base contract address we can match against. */
  canConfirmContract: z.boolean(),
  notes: z.string().optional(),
});

export const AuditorEntry = z.object({
  id: z.string(),
  names: z.array(z.string()).min(1),
  /** Auditor-controlled domains. A PDF on the project's own site never counts (§10.2). */
  domains: z.array(z.string()).min(1),
  checker: z.enum(["certik", "search"]).default("search"),
  verified: z.string().optional(),
  notes: z.string().optional(),
});

export const PartnerEntry = z.object({
  id: z.string(),
  names: z.array(z.string()).min(1),
  domains: z.array(z.string()).min(1),
  verified: z.string().optional(),
});

export const LockerEntry = z.object({
  id: z.string(),
  name: z.string(),
  addresses: z.array(EvmAddress).min(1),
  lpType: z.literal("v2"),
  /** The official docs URL the address was copied from — required, never optional. */
  source: z.url(),
  /** Date the address was confirmed to have code on Base. */
  verifiedOnChain: z.string(),
});

export type ExchangeEntry = z.infer<typeof ExchangeEntry>;
export type AuditorEntry = z.infer<typeof AuditorEntry>;
export type PartnerEntry = z.infer<typeof PartnerEntry>;
export type LockerEntry = z.infer<typeof LockerEntry>;

export const exchanges = z.array(ExchangeEntry).parse(exchangesJson);
export const auditors = z.array(AuditorEntry).parse(auditorsJson);
export const partners = z.array(PartnerEntry).parse(partnersJson);
export const lockers = z.array(LockerEntry).parse(lockersJson);

/** Names in announcements vary in case, spacing and punctuation ("Gate.io", "gate io"). */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookup<T extends { names: string[] }>(entries: T[], name: string): T | null {
  const needle = normalize(name);
  if (!needle) return null;
  return entries.find((e) => e.names.some((n) => normalize(n) === needle)) ?? null;
}

export const findExchange = (name: string) => lookup(exchanges, name);
export const findAuditor = (name: string) => lookup(auditors, name);
export const findPartner = (name: string) => lookup(partners, name);

/** Every registered locker address, lowercased, for balanceOf fan-out in §10.4. */
export function lockerAddresses(): { id: string; name: string; address: string }[] {
  return lockers.flatMap((l) =>
    l.addresses.map((address) => ({ id: l.id, name: l.name, address: address.toLowerCase() })),
  );
}
