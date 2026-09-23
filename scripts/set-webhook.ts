/**
 * Point the Telegram bot at the deployed webhook and publish its command list (§14).
 *
 *   pnpm spike scripts/set-webhook.ts
 *
 * Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and PUBLIC_BASE_URL (the https
 * production URL — Telegram refuses plain http). Prints no secrets.
 */
import { Bot } from "grammy";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = process.env.PUBLIC_BASE_URL;
  if (!token || !secret) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set");
  if (!base?.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must be the https production URL");

  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const url = `${base.replace(/\/$/, "")}/api/telegram`;

  await bot.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  await bot.api.setMyCommands([
    { command: "check", description: "Check an announcement: a link or the text" },
    { command: "method", description: "How Obelus checks each claim" },
    { command: "help", description: "How to use Obelus" },
  ]);

  const info = await bot.api.getWebhookInfo();
  console.log(`bot     : @${me.username}`);
  console.log(`webhook : ${info.url}`);
  console.log(`pending : ${info.pending_update_count}`);
  if (info.last_error_message) console.log(`last error: ${info.last_error_message}`);
}

main().catch((e) => {
  console.error("set-webhook failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
