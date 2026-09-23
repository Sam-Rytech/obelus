/**
 * LLM adapter — provider selection, the Gemini request/response contract, and the
 * model fallback. All offline: fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLlm,
  FallbackLlm,
  GeminiLlm,
  isRetryable,
  llmConfigured,
  LlmRequestError,
  StubLlm,
  type Llm,
} from "../src/lib/llm";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

const ok = (text: string, finishReason = "STOP") =>
  Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

describe("GeminiLlm", () => {
  it("sends the key in a header, never the URL, and asks for JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiLlm("SECRET", "gemini-3.6-flash").complete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      json: true,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain("SECRET");
    expect(url).toContain("/models/gemini-3.6-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET");
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.temperature).toBe(0);
    // Default thinking made production time out (2,655 thinking tokens, 15.9 s).
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("returns the text of the first candidate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok('{"claims":[]}')));
    const text = await new GeminiLlm("k", "m").complete({ system: "s", messages: [{ role: "user", content: "x" }] });
    expect(text).toBe('{"claims":[]}');
  });

  it("refuses a response cut off at the token limit — it would be truncated JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok('{"claims":[', "MAX_TOKENS")));
    await expect(
      new GeminiLlm("k", "m").complete({ system: "s", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/token limit/);
  });

  it("surfaces the HTTP status of a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "quota" } }, { status: 429 })));
    await expect(
      new GeminiLlm("k", "m").complete({ system: "s", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("fallback", () => {
  const failing = (status?: number): Llm => ({
    name: `fail-${status}`,
    complete: async () => {
      throw status === undefined ? new TypeError("fetch failed") : new LlmRequestError("x", status);
    },
  });

  it("moves to the next model on quota, overload, retirement or no connection", async () => {
    for (const status of [429, 503, 404, undefined]) {
      const llm = new FallbackLlm([failing(status), new StubLlm(["from fallback"])]);
      await expect(llm.complete({ system: "s", messages: [] })).resolves.toBe("from fallback");
    }
  });

  it("does not waste the fallback on a bad request that would fail everywhere", async () => {
    const fallback = new StubLlm(["never"]);
    const llm = new FallbackLlm([failing(400), fallback]);
    await expect(llm.complete({ system: "s", messages: [] })).rejects.toMatchObject({ status: 400 });
    expect(fallback.calls).toHaveLength(0);
  });

  it("classifies errors", () => {
    expect(isRetryable(new LlmRequestError("x", 429))).toBe(true);
    expect(isRetryable(new LlmRequestError("x", 400))).toBe(false);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("provider selection", () => {
  it("uses Gemini with the primary → fallback chain when LLM_PROVIDER=gemini", () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "k";
    delete process.env.GEMINI_MODEL;
    expect(createLlm().name).toBe("gemini:gemini-3.5-flash-lite → gemini:gemini-3.6-flash");
  });

  it("stays on Anthropic by default", () => {
    delete process.env.LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "k";
    expect(createLlm().name).toMatch(/^anthropic:/);
  });

  it("reports configured only when the SELECTED provider has a key", () => {
    process.env.LLM_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "k";
    expect(llmConfigured()).toBe(false);
  });
});
