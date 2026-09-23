/**
 * TVL — architecture §10.6, plus the floor rule: "crossed $4M" is true of $40M.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkTvl, decideTvl } from "../src/checkers/tvl";
import type { Ctx } from "../src/checkers/types";
import { Budget } from "../src/lib/budget";
import { resetCacheForTests } from "../src/lib/cache";
import type { Claim, Project } from "../src/lib/schema";
import { Trace } from "../src/lib/trace";

const project: Project = { chain: "base", name: "Aerodrome" };
const claimOf = (quote: string, amountUsd: number): Claim => ({ id: "c1", type: "TVL", quote, params: { amountUsd } });
const ctx = (): Ctx => ({ budget: new Budget(12), trace: new Trace(), timeoutMs: 8_000 });

beforeEach(() => resetCacheForTests());
afterEach(() => vi.unstubAllGlobals());

describe("decideTvl", () => {
  it("VERIFIED within ±25%", () => {
    expect(decideTvl(100, 124, "TVL is $100").verdict).toBe("VERIFIED");
    expect(decideTvl(100, 76, "TVL is $100").verdict).toBe("VERIFIED");
  });

  it("CONTRADICTED outside ±25% for a point figure", () => {
    expect(decideTvl(100, 130, "TVL is $100").verdict).toBe("CONTRADICTED");
    expect(decideTvl(100, 70, "TVL is $100").verdict).toBe("CONTRADICTED");
  });

  it("treats 'crossed' / 'over' / 'more than' as a floor", () => {
    for (const q of ["TVL has crossed $4M", "TVL of over $4M", "more than $4M locked", "TVL surpassed $4M"]) {
      expect(decideTvl(4e6, 40e6, q).verdict, q).toBe("VERIFIED");
    }
  });

  it("still CONTRADICTS a floor claim when TVL is far below it", () => {
    expect(decideTvl(4e6, 1e6, "TVL has crossed $4M").verdict).toBe("CONTRADICTED");
  });

  it("states the size and direction of a miss", () => {
    expect(decideTvl(100e6, 50e6, "TVL is $100M").reason).toContain("50% below");
  });
});

describe("checkTvl", () => {
  it("uses the 17-byte /tvl endpoint, not /protocols", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("372236320.33", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkTvl(claimOf("TVL has crossed $370,000,000", 370e6), project, ctx());
    expect(r.verdict).toBe("VERIFIED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.llama.fi/tvl/aerodrome");
    expect(r.qualifier).toContain("DefiLlama now:");
  });

  it("UNVERIFIED NOT_ON_DEFILLAMA only when DefiLlama answers 'not found'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/protocols") ? Response.json([]) : new Response("Protocol not found", { status: 400 }),
      ),
    );
    const r = await checkTvl(claimOf("TVL is $1M", 1e6), project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("NOT_ON_DEFILLAMA");
  });

  it("reports SOURCE_ERROR, not 'not listed', when DefiLlama is unreachable", async () => {
    // The Day-2 lesson: an unreachable source is not an answer.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const r = await checkTvl(claimOf("TVL is $1M", 1e6), project, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.reason).toContain("SOURCE_ERROR");
    expect(r.reason).not.toContain("NOT_ON_DEFILLAMA");
  });

  it("finds 'Aerodrome Finance' under DefiLlama's shorter 'aerodrome'", async () => {
    // The live-run miss: the full-name slug doesn't exist on DefiLlama.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/tvl/aerodrome") ? new Response("372236320") : new Response("Protocol not found", { status: 400 }),
      ),
    );
    const r = await checkTvl(claimOf("TVL has crossed $370,000,000", 370e6), { chain: "base", name: "Aerodrome Finance" }, ctx());
    expect(r.verdict).toBe("VERIFIED");
    expect(r.qualifier).toContain('matched DefiLlama\'s "aerodrome"');
  });

  it("never CONTRADICTS through a shortened-name match — it may be another protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/tvl/nova") ? new Response("50000000") : new Response("Protocol not found", { status: 400 }),
      ),
    );
    const r = await checkTvl(claimOf("TVL is $1M", 1e6), { chain: "base", name: "Nova Finance" }, ctx());
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.qualifier).toContain("name match uncertain");
  });

  it("falls back to the /protocols name map when the derived slug misses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/tvl/aerodrome")) return new Response("Protocol not found", { status: 400 });
        if (url.endsWith("/protocols")) return Response.json([{ name: "Aerodrome", slug: "aerodrome-v1" }]);
        if (url.endsWith("/tvl/aerodrome-v1")) return new Response("1000000");
        return new Response("?", { status: 500 });
      }),
    );
    const r = await checkTvl(claimOf("TVL is $1M", 1e6), project, ctx());
    expect(r.verdict).toBe("VERIFIED");
    expect(r.evidence[0]?.url).toBe("https://defillama.com/protocol/aerodrome-v1");
  });
});
