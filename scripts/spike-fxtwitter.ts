/**
 * spike-fxtwitter — OPEN QUESTION: confirm the SUCCESS shape against live tweets,
 * and the oEmbed fallback (§7, ingest/x.ts).
 *
 * Already known (Sep 22): the API is alive and returns typed JSON on failure —
 * { code: 404, message: "NOT_FOUND", tweet: null }.
 */
import { save, h, expect, done } from "./_spike";

/** Custom UA is requested by FxTwitter's docs; it is also rate-limited, so cache 24 h. */
const FX_UA = "ObelusBot/0.1 (crypto announcement fact-checker; +https://github.com/Sam-Rytech/obelus)";

/**
 * Use tweet ids that are VERIFIABLY real and long-lived. Never invent an id to test
 * with: a nonexistent id returns a 404 from FxTwitter and an HTML error page from
 * oEmbed, which looks exactly like an outage and sends you debugging the wrong thing.
 *
 * `i` as the username exercises the path where we know only the id — which is what
 * ingest/x.ts actually has after parsing an x.com URL.
 */
const TWEETS = [
  { user: "jack", id: "20" }, // the first tweet on the platform
  { user: "i", id: "20" }, // same tweet, username-free path
];

type FxResponse = {
  code: number;
  message: string;
  tweet?: {
    url: string;
    id: string;
    text: string;
    created_at: string;
    author?: { screen_name: string; name: string };
  } | null;
};

async function main() {
  const captured: Record<string, unknown>[] = [];
  let anySuccess = false;

  h("FxTwitter API");
  for (const t of TWEETS) {
    const url = `https://api.fxtwitter.com/${t.user}/status/${t.id}`;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": FX_UA },
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json()) as FxResponse;
      captured.push({ url, status: res.status, body });

      console.log(`  ${t.user}/${t.id}`);
      console.log(`    HTTP ${res.status}, code ${body.code} (${body.message})`);
      if (body.tweet) {
        anySuccess = true;
        console.log(`    author : @${body.tweet.author?.screen_name}`);
        console.log(`    created: ${body.tweet.created_at}`);
        console.log(`    text   : ${body.tweet.text.replace(/\s+/g, " ").slice(0, 120)}`);
        console.log(`    fields : ${Object.keys(body.tweet).join(", ")}`);
      } else {
        console.log(`    no tweet body — deleted, protected, or rate-limited`);
      }
    } catch (e) {
      console.log(`  ${t.user}/${t.id} FAILED: ${String(e).slice(0, 100)}`);
      captured.push({ url, error: String(e).slice(0, 200) });
    }
  }

  expect(
    "at least one live tweet returned a body with text",
    anySuccess,
    anySuccess ? "" : "tweets may have been deleted — swap in fresh ids",
  );

  h("oEmbed fallback");
  // publish.twitter.com now 301s to publish.x.com; fetch follows it, but hit the
  // final host directly to save a round trip. omit_script=1 drops the widget <script>.
  const tweetUrl = `https://x.com/${TWEETS[0]!.user}/status/${TWEETS[0]!.id}`;
  try {
    const res = await fetch(
      `https://publish.x.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=1`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) },
    );
    const body = (await res.json()) as { html?: string; author_name?: string };
    captured.push({ oembed: body });
    console.log(`  HTTP ${res.status}, fields: ${Object.keys(body).join(", ")}`);
    console.log(`  author_name: ${body.author_name}`);
    const text = (body.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`  text from blockquote: ${text.slice(0, 140)}`);
    expect("oEmbed yields recoverable text", text.length > 0);
  } catch (e) {
    console.log(`  oEmbed FAILED: ${String(e).slice(0, 120)}`);
    expect("oEmbed fallback reachable", false, String(e).slice(0, 80));
  }

  save("fxtwitter", captured);

  done(
    "FxTwitter / oEmbed",
    anySuccess ? "Works" : "Needs fresh tweet ids",
    `api.fxtwitter.com returns { code, message, tweet{ text, raw_text, author, created_at, lang, ... } }, and typed JSON on failure. **\`/i/status/<id>\` works without the username**, so ingest only needs the id from the URL. oEmbed: publish.twitter.com 301s to **publish.x.com**; pass omit_script=1 and recover text from the blockquote. Both cached 24 h.`,
  );
}

main().catch((e) => {
  console.error("spike-fxtwitter failed:", e);
  process.exit(1);
});
