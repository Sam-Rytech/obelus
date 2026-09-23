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
 * Providers, chosen by LLM_PROVIDER:
 *   "anthropic" (default) — ANTHROPIC_API_KEY, model LLM_MODEL
 *   "gemini"              — GEMINI_API_KEY, model GEMINI_MODEL. Added Sep 24 because the
 *                           Anthropic org has no API credit; Gemini has a free tier.
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
};

export interface Llm {
  readonly name: string;
  /** Return the model's raw text completion. Callers parse and validate it. */
  complete(args: CompleteArgs): Promise<string>;
}

export type LlmProvider = "anthropic" | "gemini";

export class LlmNotConfiguredError extends Error {
  constructor(provider: LlmProvider) {
    super(`${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} is not set`);
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

// ---- Anthropic -------------------------------------------------------------------

export const DEFAULT_MODEL = "claude-sonnet-5";

class AnthropicLlm implements Llm {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.name = `anthropic:${model}`;
  }

  async complete({ system, messages, maxTokens = 4096, temperature = 0 }: CompleteArgs): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature, // 0: extraction must be reproducible for the same input
      system,
      messages,
    });

    return res.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

// ---- Gemini ----------------------------------------------------------------------

/**
 * Tried in order (GEMINI_MODEL takes a comma-separated list). Measured Sep 24 on the test
 * announcement, both kept 8/8 claims through the quote guard:
 *   gemini-3.6-flash       11.8 s, whole-sentence quotes            — primary
 *   gemini-3.5-flash-lite  19.3 s, some fragment quotes ("and BingX.")
 * Flash-Lite is the fallback because its free daily quota is far larger; newer Flash
 * models get fewer free requests and can be briefly overloaded (3.8-flash returned 503).
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
    private readonly timeoutMs = 45_000,
  ) {
    this.name = `gemini:${model}`;
  }

  async complete({ system, messages, maxTokens = 4096, temperature = 0, json }: CompleteArgs): Promise<string> {
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
          // the same claims in 3.6 s. The default thinking is what timed out production.
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
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

// ---- fallback --------------------------------------------------------------------

/**
 * Worth trying the next model: quota exhausted (429), overloaded (503), a server error,
 * a retired model (404), or no connection at all. NOT worth it for a 400 — a bad request
 * would fail the same way on every model.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof LlmRequestError) {
    return err.status === undefined || err.status === 404 || err.status === 429 || err.status >= 500;
  }
  return true; // network failure, timeout
}

export class FallbackLlm implements Llm {
  readonly name: string;

  constructor(private readonly chain: Llm[]) {
    if (chain.length === 0) throw new Error("FallbackLlm needs at least one model");
    this.name = chain.map((l) => l.name).join(" → ");
  }

  async complete(args: CompleteArgs): Promise<string> {
    let last: unknown;
    for (const llm of this.chain) {
      try {
        return await llm.complete(args);
      } catch (err) {
        last = err;
        if (!isRetryable(err)) throw err;
      }
    }
    throw last;
  }
}

// ---- selection -------------------------------------------------------------------

export function llmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === "gemini" ? "gemini" : "anthropic";
}

export function llmModel(provider: LlmProvider = llmProvider()): string {
  return provider === "gemini"
    ? process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
    : process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function createLlm(): Llm {
  const provider = llmProvider();
  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new LlmNotConfiguredError("gemini");
    const models = llmModel("gemini")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    // The primary normally answers in ~4 s, so 12 s means it's overloaded: move on while
    // the fallback (Flash-Lite, 18–29 s measured) still has time inside Vercel's 60 s.
    const chain = models.map((m, i) => new GeminiLlm(key, m, models.length === 1 ? 40_000 : i === 0 ? 12_000 : 28_000));
    return chain.length === 1 ? chain[0]! : new FallbackLlm(chain);
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LlmNotConfiguredError("anthropic");
  return new AnthropicLlm(key, llmModel("anthropic"));
}

export function llmConfigured(): boolean {
  return Boolean(llmProvider() === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY);
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
