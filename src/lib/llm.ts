/**
 * LLM adapter — architecture §6 (provider-swappable).
 *
 * The model is allowed to extract claims, normalize names and summarize evidence.
 * It is NEVER allowed to assign a verdict, produce a number, or invent a source (§3).
 * That boundary is enforced by the callers, not by the prompt: extraction output is
 * Zod-validated and quote-guarded whichever provider wrote it.
 *
 * During extraction the model has NO TOOLS (§18), so untrusted input cannot cause an
 * action — the worst case is malformed JSON, which fails validation.
 *
 * Providers, tried in the order LLM_PROVIDER lists them (e.g. "groq,gemini"); each
 * expands to its own model list, and providers without a key are skipped:
 *   "groq"      — GROQ_API_KEY,      models GROQ_MODEL    (free tier, fast)
 *   "gemini"    — GEMINI_API_KEY,    models GEMINI_MODEL  (free tier, unstable latency)
 *   "anthropic" — ANTHROPIC_API_KEY, model  LLM_MODEL     (paid credit)
 * Sep 24: the Anthropic org has no API credit, and Gemini's free tier was overloaded
 * (503s, >90 s) for hours — hence a multi-provider chain rather than one model.
 */
import Anthropic from "@anthropic-ai/sdk";

export type LlmMessage = { role: "user"; content: string };

export type CompleteArgs = {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON object where it supports that natively. */
  json?: boolean;
  /** Upper bound for this call; implementations use the smaller of this and their own. */
  timeoutMs?: number;
  /**
   * Throw if the text is unusable (e.g. malformed JSON). In a FallbackLlm, a response
   * that fails validation hands over to the next model instead of failing the check.
   */
  validate?: (text: string) => void;
};

export interface Llm {
  readonly name: string;
  /** Return the model's raw text completion. Callers parse and validate it. */
  complete(args: CompleteArgs): Promise<string>;
}

export type LlmProvider = "anthropic" | "gemini" | "groq";

const KEY_VAR: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
};

export class LlmNotConfiguredError extends Error {
  constructor(providers: LlmProvider[]) {
    super(`No API key is set for ${providers.map((p) => KEY_VAR[p]).join(" / ")}`);
    this.name = "LlmNotConfiguredError";
  }
}

/** A provider refused or failed; the message is safe to log, never contains the key. */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

const timeout = (own: number, args: CompleteArgs) => Math.max(1_000, Math.min(own, args.timeoutMs ?? own));

// ---- Anthropic -------------------------------------------------------------------

export const DEFAULT_MODEL = "claude-sonnet-5";

class AnthropicLlm implements Llm {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 40_000,
  ) {
    this.client = new Anthropic({ apiKey });
    this.name = `anthropic:${model}`;
  }

  async complete(args: CompleteArgs): Promise<string> {
    const { system, messages, maxTokens = 4096, temperature = 0 } = args;
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: maxTokens,
        temperature, // 0: extraction must be reproducible for the same input
        system,
        messages,
      },
      { timeout: timeout(this.timeoutMs, args), maxRetries: 0 },
    );

    return res.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

// ---- Gemini ----------------------------------------------------------------------

/**
 * Both kept 8/8 claims through the quote guard on the test announcement (Sep 24).
 * FREE-TIER LATENCY IS NOT STABLE: the same 650-token extraction took 3.6 s one hour,
 * then hit 503s and >90 s — from Lagos, Vercel iad1 and Vercel fra1 alike.
 * 3.6-flash first: ~4 s when healthy, and usually fails FAST (503) when overloaded.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash,gemini-3.5-flash-lite";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

export class GeminiLlm implements Llm {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 30_000,
  ) {
    this.name = `gemini:${model}`;
  }

  async complete(args: CompleteArgs): Promise<string> {
    const { system, messages, maxTokens = 4096, temperature = 0, json } = args;
    const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header, not ?key= — keeps the key out of URLs and any logged request line.
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: "user", parts: [{ text: m.content }] })),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          // JSON mode only; no responseSchema, because per-type `params` vary and Zod
          // validates the shape afterwards regardless of provider.
          ...(json ? { responseMimeType: "application/json" } : {}),
          // Extraction is copying, not reasoning. Measured Sep 24: gemini-3.6-flash spent
          // 2,655 tokens thinking by default (15.9 s); at "low" it spent 0 and answered
          // the same claims in 3.6 s.
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(timeout(this.timeoutMs, args)),
    });

    const body = (await res.json().catch(() => null)) as GeminiResponse | null;

    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      throw new LlmRequestError(`Gemini ${res.status}: ${msg.slice(0, 200)}`, res.status);
    }
    if (body?.promptFeedback?.blockReason) {
      throw new LlmRequestError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`);
    }

    const candidate = body?.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) {
      throw new LlmRequestError(`Gemini returned no text (finishReason ${candidate?.finishReason ?? "unknown"})`);
    }
    // A response cut off at the token limit would be truncated JSON — fail loudly.
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new LlmRequestError("Gemini stopped at the output token limit; the extraction is incomplete");
    }
    return text;
  }
}

// ---- Groq ------------------------------------------------------------------------

/**
 * Measured Sep 24 on the test announcement, through the quote guard:
 *   qwen/qwen3.8-27b     4.6 s  8/8 kept, exact whole-sentence quotes     — primary
 *   openai/gpt-oss-120b  2.9 s  7/8 — rewrote "listed on WEEX and BingX" as
 *                               "listed on BingX"; the guard rightly dropped it
 *   openai/gpt-oss-20b   1.2 s  malformed JSON (claims[1] not an object)   — not used
 * Groq rate-limits per model, so the second model is also a second quota.
 */
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b,openai/gpt-oss-120b";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

type GroqResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; type?: string };
};

/** Reasoning models: keep reasoning minimal and OUT of the content we parse. */
function groqReasoning(model: string): Record<string, unknown> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/")) return { reasoning_format: "hidden" };
  return {};
}

export class GroqLlm implements Llm {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 15_000,
  ) {
    this.name = `groq:${model}`;
  }

  async complete(args: CompleteArgs): Promise<string> {
    const { system, messages, maxTokens = 4096, temperature = 0, json } = args;
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature,
        max_completion_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...groqReasoning(this.model),
      }),
      signal: AbortSignal.timeout(timeout(this.timeoutMs, args)),
    });

    const body = (await res.json().catch(() => null)) as GroqResponse | null;
    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      throw new LlmRequestError(`Groq ${res.status}: ${msg.slice(0, 200)}`, res.status);
    }

    const choice = body?.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) throw new LlmRequestError(`Groq returned no text (finish_reason ${choice?.finish_reason ?? "unknown"})`);
    if (choice?.finish_reason === "length") {
      throw new LlmRequestError("Groq stopped at the output token limit; the extraction is incomplete");
    }
    return text;
  }
}

// ---- fallback --------------------------------------------------------------------

/** The whole chain must finish inside Vercel's 60 s, leaving the checks their floor. */
export const EXTRACTION_BUDGET_MS = 45_000;

export class FallbackLlm implements Llm {
  readonly name: string;

  constructor(
    private readonly chain: Llm[],
    private readonly budgetMs = EXTRACTION_BUDGET_MS,
  ) {
    if (chain.length === 0) throw new Error("FallbackLlm needs at least one model");
    this.name = chain.map((l) => l.name).join(" → ");
  }

  /**
   * Every failure falls through to the next model — timeouts, quota (429), overload
   * (503), auth (401/403), bad request (400), and a response that fails `validate`.
   * The chain spans providers with different keys and request formats, so one
   * provider's refusal says nothing about the next; and such errors return instantly,
   * so trying the next model costs almost nothing.
   */
  async complete(args: CompleteArgs): Promise<string> {
    const deadline = Date.now() + this.budgetMs;
    let last: unknown = new Error("no model was tried");

    for (const llm of this.chain) {
      const remaining = deadline - Date.now();
      if (remaining < 1_500) {
        console.warn(`[llm] extraction budget spent; skipping ${llm.name}`);
        break;
      }
      const t0 = Date.now();
      try {
        const text = await llm.complete({ ...args, timeoutMs: Math.min(args.timeoutMs ?? remaining, remaining) });
        args.validate?.(text);
        console.info(`[llm] ${llm.name} answered in ${Date.now() - t0}ms`);
        return text;
      } catch (err) {
        last = err;
        // Logged per attempt so a production failure says WHICH model failed and HOW.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[llm] ${llm.name} failed after ${Date.now() - t0}ms: ${msg.slice(0, 200)}`);
      }
    }
    throw last;
  }
}

// ---- selection -------------------------------------------------------------------

const PROVIDERS: LlmProvider[] = ["anthropic", "gemini", "groq"];

/** Providers in the order LLM_PROVIDER lists them; defaults to Anthropic alone. */
export function llmProviders(): LlmProvider[] {
  const listed = (process.env.LLM_PROVIDER || "anthropic")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is LlmProvider => (PROVIDERS as string[]).includes(p));
  return listed.length ? [...new Set(listed)] : ["anthropic"];
}

/** Back-compat: the first listed provider. */
export function llmProvider(): LlmProvider {
  return llmProviders()[0]!;
}

export function llmModel(provider: LlmProvider = llmProvider()): string {
  if (provider === "gemini") return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (provider === "groq") return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

function modelsFor(provider: LlmProvider): string[] {
  return llmModel(provider)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function build(provider: LlmProvider, key: string, model: string): Llm {
  if (provider === "groq") return new GroqLlm(key, model); // healthy: 3–5 s
  if (provider === "gemini") return new GeminiLlm(key, model); // healthy: 4–20 s
  return new AnthropicLlm(key, model);
}

export function createLlm(): Llm {
  const providers = llmProviders();
  const chain: Llm[] = [];
  for (const p of providers) {
    const key = process.env[KEY_VAR[p]];
    if (!key) continue; // a listed provider without a key is skipped, not fatal
    for (const m of modelsFor(p)) chain.push(build(p, key, m));
  }
  if (chain.length === 0) throw new LlmNotConfiguredError(providers);
  return chain.length === 1 ? chain[0]! : new FallbackLlm(chain);
}

export function llmConfigured(): boolean {
  return llmProviders().some((p) => Boolean(process.env[KEY_VAR[p]]));
}

/**
 * A scripted LLM for tests and for running the pipeline with no API key. Extraction
 * logic — quote guard, Zod validation, normalization — is deterministic and must be
 * testable without spending a token or needing a network.
 */
export class StubLlm implements Llm {
  readonly name = "stub";
  public readonly calls: { system: string; messages: LlmMessage[] }[] = [];

  constructor(private readonly responses: string[]) {}

  async complete({ system, messages }: CompleteArgs): Promise<string> {
    this.calls.push({ system, messages });
    const next = this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)];
    if (next === undefined) throw new Error("StubLlm has no response configured");
    return next;
  }
}
