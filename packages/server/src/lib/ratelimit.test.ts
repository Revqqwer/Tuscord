import { describe, it, expect, vi } from 'vitest';
import { RateLimiter, checkSlowmode } from './ratelimit.js';
import { APIException } from './errors.js';
import { RateLimits } from '@tuscord/shared';

/**
 * Redis'in INCR/EXPIRE/TTL davranışını taklit eden sahte istemci.
 * Gerçek Redis'e bağlanmadan pencere mantığını test etmemizi sağlar.
 */
function fakeRedis() {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  let now = 1_000_000;

  return {
    advance(seconds: number) {
      now += seconds * 1000;
    },
    keyCount: () => counters.size,
    eval: vi.fn(async (_script: string, _numKeys: number, key: string, windowStr: string) => {
      const window = Number(windowStr);
      const existing = counters.get(key);
      if (!existing || existing.expiresAt <= now) {
        counters.set(key, { count: 1, expiresAt: now + window * 1000 });
        return [1, window];
      }
      existing.count += 1;
      return [existing.count, Math.ceil((existing.expiresAt - now) / 1000)];
    }),
  };
}

describe("RateLimiter", () => {
  it("sınıra kadar izin verir", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i < limit; i++) {
      const result = await limiter.check('MESSAGE_CREATE', 'user:1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(limit - i - 1);
    }
  });

  it("sınırın bir üstünde reddeder", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i < limit; i++) await limiter.check('MESSAGE_CREATE', 'user:1');
    const result = await limiter.check('MESSAGE_CREATE', 'user:1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("farklı özneler birbirinin sayacını tüketmez", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i < limit; i++) await limiter.check('MESSAGE_CREATE', 'user:1');
    expect((await limiter.check('MESSAGE_CREATE', 'user:1')).allowed).toBe(false);
    expect((await limiter.check('MESSAGE_CREATE', 'user:2')).allowed).toBe(true);
  });

  it("farklı kurallar ayrı sayaç tutar", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i <= limit; i++) await limiter.check('MESSAGE_CREATE', 'user:1');
    expect((await limiter.check('MESSAGE_CREATE', 'user:1')).allowed).toBe(false);
    expect((await limiter.check('SEARCH', 'user:1')).allowed).toBe(true);
  });

  it("pencere dolunca sayaç sıfırlanır", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit, window] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i <= limit; i++) await limiter.check('MESSAGE_CREATE', 'user:1');
    expect((await limiter.check('MESSAGE_CREATE', 'user:1')).allowed).toBe(false);

    redis.advance(window);
    const after = await limiter.check('MESSAGE_CREATE', 'user:1');
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(limit - 1);
  });

  it("consume() sınır aşımında 429 fırlatır", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    const [limit] = RateLimits.MESSAGE_CREATE;

    for (let i = 0; i < limit; i++) await limiter.consume('MESSAGE_CREATE', 'user:1');
    await expect(limiter.consume('MESSAGE_CREATE', 'user:1')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it("consume() sınır içindeyken fırlatmaz", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    await expect(limiter.consume('SEARCH', 'user:1')).resolves.toMatchObject({ allowed: true });
  });

  it("her kuralda TTL yalnızca ilk istekte kurulur", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter({ redis: redis as never });
    await limiter.check('SEARCH', 'user:1');
    await limiter.check('SEARCH', 'user:1');
    // Lua betiği tek turda çalışır; sahte istemci her çağrıda bir kez tetiklenir.
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.keyCount()).toBe(1);
  });

  it("tüm tanımlı kurallar pozitif sınır ve pencereye sahiptir", () => {
    for (const [name, [limit, window]] of Object.entries(RateLimits)) {
      expect(limit, name).toBeGreaterThan(0);
      expect(window, name).toBeGreaterThan(0);
    }
  });
});

describe("checkSlowmode", () => {
  function fakeSlowRedis(setResult: 'OK' | null, ttl = 5) {
    return {
      set: vi.fn(async () => setResult),
      ttl: vi.fn(async () => ttl),
    };
  }

  it("yavaş mod kapalıysa hiç Redis'e gitmez", async () => {
    const redis = fakeSlowRedis('OK');
    await checkSlowmode(redis as never, 'c1', 'u1', 0);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("ilk mesajda geçirir", async () => {
    const redis = fakeSlowRedis('OK');
    await expect(checkSlowmode(redis as never, 'c1', 'u1', 5)).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith('slow:c1:u1', '1', 'EX', 5, 'NX');
  });

  it("süre dolmadan ikinci mesajı kalan süreyle reddeder", async () => {
    const redis = fakeSlowRedis(null, 3);
    await expect(checkSlowmode(redis as never, 'c1', 'u1', 5)).rejects.toMatchObject({
      status: 429,
      retryAfter: 3,
    });
  });

  it("TTL okunamazsa tam süreyi bildirir", async () => {
    const redis = fakeSlowRedis(null, -1);
    await expect(checkSlowmode(redis as never, 'c1', 'u1', 5)).rejects.toMatchObject({
      retryAfter: 5,
    });
  });

  it("fırlatılan hata APIException'dır", async () => {
    const redis = fakeSlowRedis(null, 3);
    await expect(checkSlowmode(redis as never, 'c1', 'u1', 5)).rejects.toBeInstanceOf(APIException);
  });
});
