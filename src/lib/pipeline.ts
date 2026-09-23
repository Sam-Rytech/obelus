/**
 * The pipeline — architecture §5: ingest → extract → resolve → check → report → store.
 *
 * Guarantees, each from a section of the architecture:
 *   - Every claim gets a result, even if its checker throws or hangs (§18 fail closed).
 *   - Checks run in parallel under a per-claim timeout and a shared 12-call budget (§5).
 *   - The model runs exactly once, for extraction; verdicts and the summary are code (§3).
 *   - The report is Zod-validated and hashed before it is stored (§8, §11).
 *
 * Anchoring on Base (§11) is Day 4 and happens after this returns — never blocking.
 */
import type { PublicClient } from "viem";

import { CHECKERS } from "../checkers/index";
import { failClosed, type Checker, type Ctx } from "../checkers/types";
import { Budget, DEFAULT_BUDGET } from "./budget";
import { extract } from "./extract";
import { reportHash } from "./hash";
import { ingest, IngestError } from "./ingest/index";
import { createLlm, LlmNotConfiguredError, type Llm } from "./llm";
import { resolveContract } from "./resolve";
import { Report, type CheckResult, type Claim, type ClaimType } from "./schema";
import type { Searcher } from "./search";
import { newReportId, saveReport } from "./store";
import { summarize } from "./summary";
import { Trace, type TraceEvent } from "./trace";

/** Per-claim ceiling. Checks run in parallel, so this bounds the check phase too. */
export const CLAIM_TIMEOUT_MS = 20_000;

/**
 * Vercel kills the function at 60 s (§18). Everything must be DONE — report hashed and
 * stored — before that, so the check phase gets whatever time extraction left over,
 * never less than a short floor that still lets cached/fast sources answer.
 */
export const PIPELINE_BUDGET_MS = 52_000;
const MIN_CHECK_MS = 5_000;

export function checkPhaseTimeout(elapsedMs: number, preferred = CLAIM_TIMEOUT_MS): number {
  return Math.max(MIN_CHECK_MS, Math.min(preferred, PIPELINE_BUDGET_MS - elapsedMs));
}
export const CALL_TIMEOUT_MS = 8_000;

/** Claim types whose checkers read the token contract. */
const NEEDS_CONTRACT: ClaimType[] = ["OWNERSHIP_RENOUNCED", "LIQUIDITY_LOCK", "EXCHANGE_LISTING"];

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export type PipelineOptions = {
  llm?: Llm;
  checkers?: Partial<Record<ClaimType, Checker>>;
  onTrace?: (e: TraceEvent) => void;
  budget?: number;
  search?: Searcher;
  rpc?: PublicClient;
  /** Persist the report. Tests and the fixture runner turn this off. */
  save?: boolean;
  claimTimeoutMs?: number;
};

export function engineVersion(): string {
  return (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.ENGINE_VERSION ?? "dev").slice(0, 7);
}

async function runChecker(checker: Checker, claim: Claim, ctx: Ctx, project: Report["project"], timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(
      () => resolve(failClosed("timeout", claim, new Error(`no answer within ${timeoutMs / 1000}s`))),
      timeoutMs,
    );
  });
  try {
    // Checkers catch their own errors, but a bug must still yield a result, not a crash.
    return await Promise.race([checker(claim, project, ctx).catch((e) => failClosed(claim.type, claim, e)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runPipeline(input: string, opts: PipelineOptions = {}): Promise<Report> {
  const started = Date.now();
  const trace = new Trace();
  if (opts.onTrace) trace.onStep(opts.onTrace);
  const ctx: Ctx = {
    budget: new Budget(opts.budget ?? DEFAULT_BUDGET),
    trace,
    timeoutMs: CALL_TIMEOUT_MS,
    search: opts.search,
    rpc: opts.rpc,
  };
  const checkers = { ...CHECKERS, ...opts.checkers };

  // 1. INGEST
  trace.step("Reading the input");
  let ingested;
  try {
    ingested = await ingest(input);
  } catch (err) {
    if (err instanceof IngestError) throw new PipelineError(err.message, `INGEST_${err.code}`);
    throw new PipelineError(`Could not read the input: ${err instanceof Error ? err.message : err}`, "INGEST_FAILED");
  }
  trace.step(
    `Read ${ingested.kind === "x" ? "an X post" : ingested.kind === "url" ? "a web page" : "pasted text"}` +
      `${ingested.source ? ` (${ingested.source.label})` : ""} — ${ingested.fetchedText.length} characters`,
  );

  // 2. EXTRACT — the only model call
  let llm: Llm;
  try {
    llm = opts.llm ?? createLlm();
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) throw new PipelineError("Claim extraction is not configured", "LLM_NOT_CONFIGURED");
    throw err;
  }
  trace.step("Extracting checkable claims");
  let extraction;
  try {
    extraction = await extract(llm, ingested.fetchedText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PipelineError(`Claim extraction failed: ${msg.slice(0, 200)}`, "EXTRACTION_FAILED");
  }
  for (const d of extraction.dropped) {
    trace.step(`Discarded a ${d.type} claim (${d.reason.split(":")[0]}): "${d.quote.slice(0, 60)}"`);
  }
  const { claims } = extraction;
  trace.step(
    claims.length
      ? `Found ${claims.length} claim${claims.length === 1 ? "" : "s"}: ${[...new Set(claims.map((c) => c.type))].join(", ")}`
      : "Found no checkable claims",
  );

  // 3. RESOLVE — only if some claim needs the contract
  let project = extraction.project;
  if (claims.some((c) => NEEDS_CONTRACT.includes(c.type))) {
    project = (await resolveContract(project, ctx)).project;
  }

  // 4. CHECK — in parallel, every claim guaranteed a result
  const timeoutMs = opts.claimTimeoutMs ?? checkPhaseTimeout(Date.now() - started);
  const results = await Promise.all(claims.map((c) => runChecker(checkers[c.type], c, ctx, project, timeoutMs)));
  trace.step(`Checked ${claims.length} claim${claims.length === 1 ? "" : "s"} using ${ctx.budget.spent} of ${DEFAULT_BUDGET} source calls`);

  // 5. REPORT
  const draft = {
    id: newReportId(),
    input: { kind: ingested.kind, value: input.slice(0, 2_000), fetchedText: ingested.fetchedText },
    project,
    claims,
    results,
    summary: summarize(project, claims, results),
    trace: trace.all(),
    engineVersion: engineVersion(),
    createdAt: new Date().toISOString(),
    reportHash: "",
  };
  // Hash the PARSED object: parsing can apply defaults, and the verify page recomputes
  // the hash from what was stored. Hashing the pre-parse draft could make them differ.
  const parsed = Report.parse(draft);
  const report: Report = { ...parsed, reportHash: reportHash(parsed) };

  // 6. STORE (anchoring on Base is Day 4)
  if (opts.save !== false) await saveReport(report);
  return report;
}
