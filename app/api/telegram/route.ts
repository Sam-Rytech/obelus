/**
 * POST /api/telegram — the bot's webhook (architecture §14).
 *
 * Telegram signs each call with the secret set by scripts/set-webhook.ts; grammY rejects
 * any request without it. The check itself runs in after(), so the webhook answers
 * Telegram immediately and the function stays alive to finish the check.
 */
import { webhookCallback } from "grammy";
import { after } from "next/server";

import { createBot } from "@/src/bot/telegram";
import { anchorReport } from "@/src/lib/anchor";
import { runPipeline } from "@/src/lib/pipeline";
import { checkRate } from "@/src/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let handler: ((req: Request) => Promise<Response>) | null = null;

function getHandler() {
  if (handler) return handler;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return null;

  const bot = createBot({
    token,
    baseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
    run: async (input) => {
      const report = await runPipeline(input);
      await anchorReport(report); // already inside after(); the reply waits for nothing but the check
      return report;
    },
    defer: (work) => after(work),
    allow: async (userId) => (await checkRate(`tg:${userId}`)).ok,
  });

  handler = webhookCallback(bot, "std/http", { secretToken: secret });
  return handler;
}

export async function POST(req: Request) {
  const h = getHandler();
  if (!h) {
    return Response.json({ code: "BOT_NOT_CONFIGURED", message: "The Telegram bot is not configured." }, { status: 503 });
  }
  return h(req);
}
