/**
 * LLM adapter — provider chain, each provider's request/response contract, and the
 * fallback. All offline: fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLlm,
  FallbackLlm,
  GeminiLlm,
  GroqLlm,
  llmConfigured,
  llmProviders,
  LlmRequestError,
  StubLlm,
  type Llm,
} from "../src/lib/llm";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

const args = { system: "s", messages: [{ role: "user" as const, content: "x" }] };

describe("GeminiLlm", () => {
  const ok = (text: string, finishReason = "STOP") =>
    Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

  it("sends the key in a header, never the URL, asks for JSON, and keeps thinking low", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiLlm("SECRET", "gemini-3.6-flash").complete({ ...args, json: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain("SECRET");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET");
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    // Default thinking made production time out (2,655 thinking tokens, 15.9 s).
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("refuses a response cut off at the token limit — it would be truncated JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok('{"claims":[', "MAX_TOKENS")));
    await expect(new GeminiLlm("k", "m").complete(args)).rejects.toThrow(/token limit/);
  });

  it("surfaces the HTTP status of a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "quota" } }, { status: 429 })));
    await expect(new GeminiLlm("k", "m").complete(args)).rejects.toMatchObject({ status: 429 });
  });
});

describe("GroqLlm", () => {
  const ok = (content: string, finish_reason = "stop") => Response.json({ choices: [{ message: { content }, finish_reason }] });

  it("uses the OpenAI-style chat API with a bearer key and JSON mode", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new GroqLlm("SECRET", "qwen/qwen3.8-27b").complete({ ...args, json: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(url).not.toContain("SECRET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET");
    const body = JSON.parse(String(init.body));
    expect(body.messages[0]).toEqual({ role: "system", content: "s" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("keeps each reasoning model's reasoning out of the parsed content", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new GroqLlm("k", "qwen/qwen3.8-27b").complete(args);
    await new GroqLlm("k", "openai/gpt-oss-120b").complete(args);
    const [qwen, oss] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(qwen.reasoning_format).toBe("hidden");
    expect(oss).toMatchObject({ reasoning_effort: "low", include_reasoning: false });
  });

  it("refuses a response cut off at the token limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok('{"claims":[', "length")));
    await expect(new GroqLlm("k", "m").complete(args)).rejects.toThrow(/token limit/);
  });
});

describe("FallbackLlm", () => {
  const failing = (err: unknown): Llm => ({
    name: "fails",
    complete: async () => {
      throw err;
    },
  });

  it("falls through on every kind of failure — the chain spans providers", async () => {
    // 400/401 from one provider say nothing about the next one's key or request format.
    for (const err of [
      new LlmRequestError("x", 429),
      new LlmRequestError("x", 503),
      new LlmRequestError("x", 400),
      new LlmRequestError("x", 401),
      new TypeError("fetch failed"),
    ]) {
      const llm = new FallbackLlm([failing(err), new StubLlm(["from fallback"])]);
      await expect(llm.complete(args)).resolves.toBe("from fallback");
    }
  });

  it("hands over to the next model when a response fails validation", async () => {
    // gpt-oss-20b really did this: valid JSON, wrong shape.
    const llm = new FallbackLlm([new StubLlm(["not what we asked for"]), new StubLlm(['{"ok":true}'])]);
    const out = await llm.complete({
      ...args,
      validate: (t) => {
        if (!t.startsWith("{")) throw new Error("invalid");
      },
    });
    expect(out).toBe('{"ok":true}');
  });

  it("shares one deadline across the whole chain", async () => {
    const seen: number[] = [];
    const slow: Llm = {
      name: "slow",
      complete: async (a) => {
        seen.push(a.timeoutMs ?? -1);
        await new Promise((r) => setTimeout(r, 40));
        throw new Error("timeout");
      },
    };
    await expect(new FallbackLlm([slow, slow, slow], 2_000).complete(args)).rejects.toThrow();
    // Each later model is offered less time than the one before.
    expect(seen[0]).toBeLessThanOrEqual(2_000);
    expect(seen[1]!).toBeLessThan(seen[0]!);
  });

  it("stops trying once the budget is spent", async () => {
    const tried: string[] = [];
    const slow = (name: string): Llm => ({
      name,
      complete: async () => {
        tried.push(name);
        await new Promise((r) => setTimeout(r, 700));
        throw new Error("timeout");
      },
    });
    await expect(new FallbackLlm([slow("a"), slow("b"), slow("c")], 1_600).complete(args)).rejects.toThrow();
    expect(tried).toEqual(["a"]); // after "a", under 1.5 s remained
  });
});

describe("provider chain", () => {
  it("expands providers in LLM_PROVIDER order into their model lists", () => {
    process.env.LLM_PROVIDER = "groq,gemini";
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "k";
    delete process.env.GROQ_MODEL;
    delete process.env.GEMINI_MODEL;
    expect(createLlm().name).toBe(
      "groq:qwen/qwen3.8-27b → groq:openai/gpt-oss-120b → gemini:gemini-3.6-flash → gemini:gemini-3.5-flash-lite",
    );
  });

  it("skips a listed provider that has no key", () => {
    process.env.LLM_PROVIDER = "groq,gemini";
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = "k";
    process.env.GEMINI_MODEL = "gemini-3.6-flash";
    expect(createLlm().name).toBe("gemini:gemini-3.6-flash");
  });

  it("throws only when no listed provider has a key", () => {
    process.env.LLM_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;
    expect(llmConfigured()).toBe(false);
    expect(() => createLlm()).toThrow(/GROQ_API_KEY/);
  });

  it("defaults to Anthropic and ignores unknown names", () => {
    delete process.env.LLM_PROVIDER;
    expect(llmProviders()).toEqual(["anthropic"]);
    process.env.LLM_PROVIDER = "nonsense, groq";
    expect(llmProviders()).toEqual(["groq"]);
  });
});
