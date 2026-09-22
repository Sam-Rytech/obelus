/**
 * Cache — architecture §12.
 *
 * TTLs: exchange symbol lists 10 min; Tavily results 24 h; CertiK pages 24 h;
 * tweets 24 h. Caching is not just a speed concern here — it is how we stay inside
 * Tavily's 1,000 credits/month and FxTwitter's rate limit (§20).
 *
 * Upstash is optional: with no REST URL configured we fall back to an in-process Map
 * so the whole pipeline runs locally with no keys at all. The fallback is per-process
 * and therefore useless on serverless, which is exactly why production sets Upstash.
 */
import { Redis } from "@upstash/redis";

export const TTL = {
  EXCHANGE_SYMBOLS: 60 * 10,
  TAVILY: 60 * 60 * 24,
  CERTIK: 60 * 60 * 24,
  TWEET: 60 * 60 * 24,
  DEFILLAMA_SLUGS: 60 * 60 * 24,
} as const;

interface CacheBackend {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

class MemoryCache implements CacheBackend {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

class RedisCache implements CacheBackend {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    // A cache outage must degrade to a miss, never fail the request.
    try {
      return (await this.redis.get<T>(key)) ?? null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, { ex: ttlSeconds });
    } catch {
      /* ignore */
    }
  }
}

function createBackend(): CacheBackend {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return new MemoryCache();
  return new RedisCache(new Redis({ url, token }));
}

let backend: CacheBackend | undefined;

export function cache(): CacheBackend {
  backend ??= createBackend();
  return backend;
}

export function usingRedis(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Read-through cache: return the cached value, or compute, store and return it. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cache().get<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cache().set(key, value, ttlSeconds);
  return value;
}

/** Reset the backend. Tests only. */
export function resetCacheForTests(): void {
  backend = undefined;
}
