/**
 * GET /api/health — architecture §12, §20 ("demo breaks during judging").
 *
 * One cheap probe per upstream, in parallel, 6 s each, cached 60 s per instance.
 * Tavily is reported as "configured" and never called, so a status page can't burn
 * search credits; a key being present is never reported as "up". Every provider in the
 * extraction chain gets a real probe, because extraction is the step every check depends
 * on: Groq via its free /models, Gemini via the free models.get (no quota spent either
 * way), Anthropic via a 1-token call.
 */
import { Redis } from "@upstash/redis";
import { createPublicClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { currentEasChain, easRpcUrl } from "@/src/lib/chains";
import { llmModel, llmProviders } from "@/src/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "configured": key present but deliberately not called — never reported as "up". */
type State = "up" | "down" | "not configured" | "configured";
type Probe = { id: string; label: string; role: string; state: State; ms?: number; detail?: string };

const TIMEOUT = 6_000;

async function http200(url: string, init?: RequestInit, okStatus = (s: number) => s < 500): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  const body = await res.text();
  // A region block is the source refusing US to serve US — "up" would be a lie. Binance
  // answers Vercel's US region with 451; the earlier "any answer means up" rule hid that.
  if (res.status === 451 || res.status === 403) {
    return { ok: false, detail: `blocked from this server's region (HTTP ${res.status})` };
  }
  // Some probes deliberately hit a missing resource: a 404 still means the source is up.
  return { ok: okStatus(res.status) && body.length > 0, detail: `HTTP ${res.status}` };
}

async function probe(id: string, label: string, role: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { id, label, role, state: r.ok ? "up" : "down", ms: Date.now() - t0, detail: r.detail };
  } catch (err) {
    return { id, label, role, state: "down", ms: Date.now() - t0, detail: err instanceof Error ? err.message.slice(0, 80) : "error" };
  }
}

const configured = (id: string, label: string, role: string, isSet: boolean): Probe => ({
  id,
  label,
  role,
  // A key being present proves nothing about the service, so it is never "up".
  state: isSet ? "configured" : "not configured",
  detail: isSet ? "key set; not called here, to save credits" : "not configured",
});

async function runProbes(): Promise<Probe[]> {
  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const client = createPublicClient({ chain: base, transport: http(rpc, { retryCount: 1 }) });

  const probes: Promise<Probe>[] = [
    probe("weex", "WEEX", "Exchange listings, token contracts", () => http200("https://api-spot.weex.com/api/v2/public/products")),
    probe("bingx", "BingX", "Exchange listings", () => http200("https://open-api.bingx.com/openApi/swap/v2/server/time")),
    probe("mexc", "MEXC", "Exchange listings", () => http200("https://api.mexc.com/api/v3/ping")),
    probe("bybit", "Bybit", "Exchange listings", () => http200("https://api.bytick.com/v5/market/time")),
    probe("binance", "Binance", "Exchange listings", () => http200("https://api.binance.com/api/v3/ping")),
    probe("okx", "OKX", "Exchange listings", () => http200("https://www.okx.com/api/v5/public/time")),
    probe("certik", "CertiK Skynet", "Audits", () =>
      // A missing project answers 404 quickly and small — proof the site is up.
      http200("https://skynet.certik.com/projects/obelus-health-probe", {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ObelusHealth/0.1)" },
      }),
    ),
    probe("defillama", "DefiLlama", "Total value locked", () => http200("https://api.llama.fi/tvl/aerodrome")),
    probe("dexscreener", "DexScreener", "Pools and contract lookup", () =>
      http200("https://api.dexscreener.com/latest/dex/search?q=AERO"),
    ),
    probe("fxtwitter", "FxTwitter", "Reading X posts", () =>
      http200("https://api.fxtwitter.com/i/status/20", { headers: { "user-agent": "ObelusBot/0.1" } }),
    ),
    probe("base", "Base RPC", "Ownership and liquidity checks (mainnet)", async () => {
      const block = await client.getBlockNumber();
      return { ok: block > 0n, detail: `block ${block}` };
    }),
  ];

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  probes.push(
    url && token
      ? probe("redis", "Upstash Redis", "Report storage, caching", async () => {
          const pong = await new Redis({ url, token }).ping();
          return { ok: pong === "PONG", detail: String(pong) };
        })
      : Promise.resolve(configured("redis", "Upstash Redis", "Report storage, caching", false)),
  );

  const pk = process.env.ATTESTER_PRIVATE_KEY;
  const net = currentEasChain();
  const receiptRole = `Receipts on ${net.label}`;
  probes.push(
    pk && process.env.EAS_SCHEMA_UID
      ? probe("eas", "EAS", receiptRole, async () => {
          const address = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex).address;
          // Balance on the RECEIPT network, which may be a testnet — not the checkers' mainnet.
          const easClient = createPublicClient({ chain: net.chain, transport: http(easRpcUrl(net), { retryCount: 1 }) });
          const bal = await easClient.getBalance({ address });
          // Enough for a few hundred attestations at Base fees; warn well before empty.
          return { ok: bal > 20_000_000_000_000n, detail: `attester holds ${Number(formatEther(bal)).toFixed(5)} ETH` };
        })
      : Promise.resolve(configured("eas", "EAS", receiptRole, false)),
  );

  // The extractor is the one step every check needs, so every provider in the chain
  // (LLM_PROVIDER, in order) gets a real probe — and only those, not every key present.
  const providers = llmProviders();
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const roleFor = (p: string) =>
    providers.length > 1
      ? `Reading claims out of the text (${providers.indexOf(p as never) === 0 ? "first choice" : `fallback ${providers.indexOf(p as never)}`})`
      : "Reading claims out of the text";

  if (providers.includes("groq")) {
    // /models is free and doesn't touch the rate-limited chat quota.
    const role = roleFor("groq");
    const primary = llmModel("groq").split(",")[0]!.trim();
    probes.push(
      groqKey
        ? probe("groq", `Groq (${primary})`, role, async () => {
            const res = await fetch("https://api.groq.com/openai/v1/models", {
              headers: { authorization: `Bearer ${groqKey}` },
              signal: AbortSignal.timeout(TIMEOUT),
              cache: "no-store",
            });
            if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
            const body = (await res.json()) as { data?: { id: string }[] };
            const listed = body.data?.some((m) => m.id === primary);
            return { ok: Boolean(listed), detail: listed ? "key valid, model available" : `${primary} not offered` };
          })
        : Promise.resolve(configured("groq", "Groq", role, false)),
    );
  }

  if (providers.includes("gemini")) {
    const role = roleFor("gemini");
    // models.get is free and doesn't touch the generation quota, so a status page can
    // never eat into the free tier. It proves the key and the primary model are valid.
    const primary = llmModel("gemini").split(",")[0]!.trim();
    probes.push(
      geminiKey
        ? probe("gemini", `Gemini (${primary})`, role, async () => {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${primary}`, {
              headers: { "x-goog-api-key": geminiKey },
              signal: AbortSignal.timeout(TIMEOUT),
              cache: "no-store",
            });
            if (res.ok) return { ok: true, detail: "key and model valid (quota not spent checking)" };
            const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            return { ok: false, detail: body?.error?.message?.slice(0, 80) ?? `HTTP ${res.status}` };
          })
        : Promise.resolve(configured("gemini", "Gemini", role, false)),
    );
  }

  // Anthropic: a 1-token call (a tiny fraction of a cent, at most once a minute per
  // instance), which catches what a key-present check can't — e.g. an org with no credit.
  if (providers.includes("anthropic")) probes.push(
    anthropicKey
      ? probe("anthropic", "Anthropic", roleFor("anthropic"), async () => {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: process.env.LLM_MODEL || "claude-sonnet-5",
              max_tokens: 1,
              messages: [{ role: "user", content: "." }],
            }),
            signal: AbortSignal.timeout(TIMEOUT),
          });
          if (res.ok) return { ok: true, detail: "HTTP 200" };
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          return { ok: false, detail: body?.error?.message?.slice(0, 80) ?? `HTTP ${res.status}` };
        })
      : Promise.resolve(configured("anthropic", "Anthropic", roleFor("anthropic"), false)),
  );

  const results = await Promise.all(probes);
  results.push(configured("tavily", "Tavily", "Partner and auditor search", Boolean(process.env.TAVILY_API_KEY)));
  return results;
}

let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) return Response.json(cache.body);

  const sources = await runProbes();
  const down = sources.filter((s) => s.state === "down" || s.state === "not configured").length;
  const body = {
    status: down === 0 ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    sources,
  };
  cache = { at: Date.now(), body };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
