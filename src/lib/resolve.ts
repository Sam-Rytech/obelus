/**
 * Contract resolution — architecture §5 step 3.
 *
 * When the announcement states no contract, Obelus may look one up on DexScreener so
 * the on-chain checks (ownership, lock) can still run. This is where the agent CHOOSES
 * a follow-up lookup, so it is also where a wrong choice could do damage:
 * same-ticker clones are everywhere on Base, and resolving to one would aim every
 * on-chain check at the wrong token.
 *
 * So it resolves only when the answer is unambiguous:
 *   - exactly one Base token matches the ticker, or
 *   - several do, but exactly one also matches the project NAME.
 * Otherwise it leaves the contract empty and records the candidates in the trace;
 * contract-dependent checks then return UNVERIFIED NO_CONTRACT_RESOLVED.
 *
 * A resolved contract is marked contractSource "resolved", which stops it from ever
 * producing DIFFERENT_TOKEN_SAME_TICKER (see checkers/exchange/market.ts).
 */
import type { Ctx } from "../checkers/types";
import { getJson } from "../checkers/types";
import { compact } from "../checkers/text";
import type { Project } from "./schema";

const SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";

type Pair = {
  chainId: string;
  baseToken: { address: string; name: string; symbol: string };
  liquidity?: { usd?: number };
};

export type Candidate = { address: string; name: string; symbol: string; liquidityUsd: number };

export type Resolution = {
  project: Project;
  candidates: Candidate[];
  outcome: "stated" | "resolved" | "ambiguous" | "not-found" | "skipped";
};

/** Pure: pick a single token from DexScreener pairs, or refuse. Exported for tests. */
export function chooseToken(
  pairs: Pair[],
  ticker: string,
  name: string | undefined,
): { chosen: Candidate | null; candidates: Candidate[] } {
  const byAddress = new Map<string, Candidate>();
  for (const p of pairs) {
    if (p.chainId !== "base") continue;
    if (p.baseToken?.symbol?.toUpperCase() !== ticker.toUpperCase()) continue;
    const address = p.baseToken.address.toLowerCase();
    const prev = byAddress.get(address);
    const liq = p.liquidity?.usd ?? 0;
    byAddress.set(address, {
      address,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      liquidityUsd: (prev?.liquidityUsd ?? 0) + liq,
    });
  }

  const candidates = [...byAddress.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  if (candidates.length === 1) return { chosen: candidates[0] ?? null, candidates };

  if (candidates.length > 1 && name) {
    const want = compact(name);
    const named = candidates.filter((c) => compact(c.name) === want);
    if (named.length === 1) return { chosen: named[0] ?? null, candidates };
  }

  // Deliberately NOT "highest liquidity wins": that heuristic is exactly how a
  // well-funded clone would get picked.
  return { chosen: null, candidates };
}

export async function resolveContract(project: Project, ctx: Ctx): Promise<Resolution> {
  if (project.contract) {
    return { project: { ...project, contractSource: "stated" }, candidates: [], outcome: "stated" };
  }
  if (!project.ticker) {
    return { project, candidates: [], outcome: "skipped" };
  }

  try {
    ctx.budget.spend("dexscreener:resolve");
    const body = await getJson<{ pairs?: Pair[] }>(`${SEARCH}${encodeURIComponent(project.ticker)}`, ctx);
    const { chosen, candidates } = chooseToken(body.pairs ?? [], project.ticker, project.name);

    if (chosen) {
      ctx.trace.step(`Resolved ${project.ticker} to ${chosen.address} on Base via DexScreener`);
      return {
        project: { ...project, contract: chosen.address, contractSource: "resolved" },
        candidates,
        outcome: "resolved",
      };
    }

    if (candidates.length > 1) {
      ctx.trace.step(
        `${candidates.length} different Base tokens use the ticker ${project.ticker} — not guessing: ${candidates
          .slice(0, 3)
          .map((c) => `${c.name} ${c.address.slice(0, 10)}…`)
          .join(", ")}`,
      );
      return { project, candidates, outcome: "ambiguous" };
    }

    ctx.trace.step(`No Base token with ticker ${project.ticker} found on DexScreener`);
    return { project, candidates, outcome: "not-found" };
  } catch (err) {
    // Resolution is an optimization; its failure only means on-chain checks can't run.
    ctx.trace.step(`Contract lookup failed (${err instanceof Error ? err.message : String(err)}) — continuing without it`);
    return { project, candidates: [], outcome: "not-found" };
  }
}
