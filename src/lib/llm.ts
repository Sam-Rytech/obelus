/**
 * LLM adapter — architecture §6 (provider-swappable).
 *
 * The model is allowed to extract claims, normalize names and summarize evidence.
 * It is NEVER allowed to assign a verdict, produce a number, or invent a source (§3).
 * That boundary is enforced by the callers, not by the prompt: extraction output is
 * Zod-validated and quote-guarded, and the summary is checked against the results.
 *
 * During extraction the model has NO TOOLS (§18), so untrusted input cannot cause an
 * action — the worst case is malformed JSON, which fails validation.
 */
import Anthropic from "@anthropic-ai/sdk";

export type LlmMessage = { role: "user"; content: string };

export interface Llm {
  readonly name: string;
  /** Return the model's raw text completion. Callers parse and validate it. */
  complete(args: {
    system: string;
    messages: LlmMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<string>;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "LlmNotConfiguredError";
  }
}

class AnthropicLlm implements Llm {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
    this.name = `anthropic:${model}`;
  }

  async complete({
    system,
    messages,
    maxTokens = 4096,
    temperature = 0,
  }: {
    system: string;
    messages: LlmMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
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

export const DEFAULT_MODEL = "claude-sonnet-5";

export function createLlm(): Llm {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmNotConfiguredError();
  return new AnthropicLlm(apiKey, process.env.LLM_MODEL || DEFAULT_MODEL);
}

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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

  async complete({ system, messages }: { system: string; messages: LlmMessage[] }): Promise<string> {
    this.calls.push({ system, messages });
    const next = this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)];
    if (next === undefined) throw new Error("StubLlm has no response configured");
    return next;
  }
}
