/**
 * Telegram bot — architecture §14.
 *
 *   /check <url or text>   (alias /obelus) — or reply /check to a message to check it
 *   /start, /help, /method
 *
 * Telegram expects a webhook to answer within seconds; a check takes 7–20 s. So the bot
 * replies "Checking…" immediately, hands the real work to `defer` (Next's `after()` in
 * production, so the serverless function stays alive), then edits that message with the
 * verdicts and a link to the full report with its proof.
 */
import { Bot, type Context } from "grammy";

import type { Report, Verdict } from "../lib/schema";
import { looksLikeQuestion, QUESTION_HINT, tally } from "../lib/summary";

export type BotDeps = {
  token: string;
  baseUrl: string;
  run: (input: string) => Promise<Report>;
  /** Run work after the webhook response has been sent. */
  defer: (work: () => Promise<void>) => void;
  /** Per-user rate limit; true = allowed. */
  allow: (userId: string) => Promise<boolean>;
};

const MARK: Record<Verdict, string> = { VERIFIED: "※", CONTRADICTED: "÷", UNVERIFIED: "?" };
const WORD: Record<Verdict, string> = { VERIFIED: "Verified", CONTRADICTED: "Contradicted", UNVERIFIED: "Unverified" };

const HELP = `<b>Obelus</b> checks crypto announcements claim by claim, against the one source that can confirm each claim.

<b>/check</b> followed by an X post link, a web page link or the announcement text.
Or ask: <b>/check is $PEPE listed on MEXC?</b>
Or reply <b>/check</b> to a message to check that message.

※ verified   ÷ contradicted   ? unverified (no source could settle it — not the same as false)`;

const METHOD = `Obelus never lets the AI decide. A model only pulls the claims out of the text; code checks each one against its primary source:

• Listings — the exchange's own API (WEEX, BingX, Binance, Bybit, OKX, MEXC)
• Audits — CertiK's own project page, or the auditor's own site
• Ownership and liquidity locks — read from Base
• Partnerships — the partner's own site
• TVL — DefiLlama

Every mark links to its proof, and every report is fingerprinted on Base.`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function short(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Contradictions first — that is what a group needs to see before anyone buys. */
const PRIORITY: Record<Verdict, number> = { CONTRADICTED: 0, VERIFIED: 1, UNVERIFIED: 2 };

/** Pure: the reply for a finished report. Exported for tests. */
export function formatReport(report: Report, baseUrl: string): string {
  const t = tally(report.results);
  const question = report.mode === "question";
  const name = question
    ? `Is ${report.project.ticker ?? "it"} listed?`
    : (report.project.name ?? report.project.ticker ?? "this announcement");
  const byId = new Map(report.claims.map((c) => [c.id, c]));

  const lines = [
    `<b>${escapeHtml(name)}</b>${!question && report.project.ticker && report.project.name ? ` (${escapeHtml(report.project.ticker)})` : ""}`,
    `※ ${t.verified} verified   ÷ ${t.contradicted} contradicted   ? ${t.unverified} unverified` +
      (t.notCheckable ? `   (${t.notCheckable} not checkable yet)` : ""),
  ];

  if (/TEST ANNOUNCEMENT\s*[—-]\s*written by the Obelus team/i.test(report.input.fetchedText)) {
    lines.push("<i>Test announcement written by the Obelus team.</i>");
  }

  // A question's answers are short (one per exchange), so show them all.
  const shown = question ? 8 : 3;
  const top = [...report.results].sort((a, b) => PRIORITY[a.verdict] - PRIORITY[b.verdict]).slice(0, shown);
  if (top.length) lines.push("");
  for (const r of top) {
    const claim = byId.get(r.claimId);
    if (!claim) continue;
    const label = question ? `Listed on ${String(claim.params.exchange)}?` : `“${short(claim.quote, 90)}”`;
    lines.push(`${MARK[r.verdict]} <b>${WORD[r.verdict]}</b> — ${escapeHtml(label)}`);
    const why = r.qualifier ?? r.reason.split(" — ")[1] ?? "";
    if (why) lines.push(`   ${escapeHtml(short(why, 120))}`);
  }
  if (report.results.length > shown) lines.push(`…and ${report.results.length - shown} more.`);
  if (report.claims.length === 0) {
    lines.push(looksLikeQuestion(report.input.fetchedText) ? escapeHtml(QUESTION_HINT) : "No checkable claims found.");
  }

  lines.push("", `Full report with proof: ${baseUrl.replace(/\/$/, "")}/r/${report.id}`);
  return lines.join("\n");
}

/** What to check: the command's argument, or the message it replies to. */
export function inputFrom(ctx: Context): string {
  const arg = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (arg) return arg;
  const replied = ctx.message?.reply_to_message;
  return (replied?.text ?? replied?.caption ?? "").trim();
}

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token);

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
  bot.command("method", (ctx) => ctx.reply(METHOD));

  bot.command(["check", "obelus"], async (ctx) => {
    const input = inputFrom(ctx);
    if (!input) {
      await ctx.reply("Send /check followed by a link or the announcement text — or reply /check to a message.");
      return;
    }
    if (!(await deps.allow(String(ctx.from?.id ?? ctx.chat.id)))) {
      await ctx.reply("Limit reached: 10 checks per hour. Try again later.");
      return;
    }

    const pending = await ctx.reply("Checking each claim against its source…", {
      reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
    });

    deps.defer(async () => {
      let text: string;
      try {
        text = formatReport(await deps.run(input), deps.baseUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        text = /INGEST|Blocked|valid URL|resolve|tweet/i.test(msg)
          ? `Couldn't read that: ${escapeHtml(short(msg, 160))}`
          : "Obelus couldn't complete this check right now. Try again shortly.";
      }
      await ctx.api
        .editMessageText(ctx.chat.id, pending.message_id, text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        })
        .catch(() => ctx.reply(text, { parse_mode: "HTML" }));
    });
  });

  return bot;
}
