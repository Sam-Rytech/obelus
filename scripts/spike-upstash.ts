/**
 * spike-upstash — confirm the Redis backend works THROUGH src/lib/cache.ts, the same
 * code path production uses, not just that the credentials are valid.
 *
 * Specifically checks the things that would silently break caching:
 *  - cache.ts actually selected Redis (not the in-memory fallback);
 *  - objects round-trip intact (the checkers cache parsed JSON, not strings);
 *  - TTLs are applied, so caches expire as architecture §12 specifies;
 *  - cached() does not re-run compute on a hit — the whole point for Tavily credits.
 */
import { Redis } from "@upstash/redis";

import { cache, cached, resetCacheForTests, usingRedis } from "../src/lib/cache";
import { h, expect, done } from "./_spike";

async function main() {
  resetCacheForTests();

  h("Backend selection");
  expect("cache.ts selected the Redis backend", usingRedis(), "UPSTASH_REDIS_REST_URL + TOKEN present");

  const key = `obelus:spike:${Date.now()}`;

  h("Round trip through cache.ts");
  const t0 = Date.now();
  const payload = { symbol: "AEROUSDT", status: "TRADING", nested: { n: 42, list: [1, 2, 3] } };
  await cache().set(key, payload, 60);
  const back = await cache().get<typeof payload>(key);
  const ms = Date.now() - t0;
  console.log(`  set + get: ${ms}ms`);
  expect("an object round-trips intact", JSON.stringify(back) === JSON.stringify(payload), JSON.stringify(back));

  h("TTL is applied");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const ttl = await redis.ttl(key);
  console.log(`  ttl: ${ttl}s`);
  expect("key carries the TTL it was set with", ttl > 0 && ttl <= 60, `${ttl}s`);

  h("cached() does not recompute on a hit");
  const readKey = `${key}:readthrough`;
  let computes = 0;
  const compute = async () => {
    computes++;
    return { value: "expensive" };
  };
  await cached(readKey, 60, compute);
  // Fresh backend instance, as a different serverless invocation would have.
  resetCacheForTests();
  await cached(readKey, 60, compute);
  expect("second call is served from Redis across instances", computes === 1, `compute ran ${computes}x`);

  h("Miss behaviour");
  const miss = await cache().get(`${key}:does-not-exist`);
  expect("a missing key returns null, not undefined or an error", miss === null);

  await redis.del(key, readKey);

  done(
    "Upstash Redis",
    "Works through cache.ts",
    `Backend auto-selected from env; objects round-trip intact; TTL applied (${ttl}s of 60); cached() served the second call from Redis across a fresh backend instance, i.e. across serverless invocations. set+get ${ms}ms from Lagos.`,
  );
}

main().catch((e) => {
  console.error("spike-upstash failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
