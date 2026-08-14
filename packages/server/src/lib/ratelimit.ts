/**
 * Redis tabanlı hız sınırlayıcı — sabit pencere sayacı.
 *
 * Neden sabit pencere: sliding window log her istek için bir sorted set
 * yazması demek; bu ölçekte gereksiz. Sabit pencerenin sınır anındaki
 * iki katı burst sorunu, kaba kuvvet ve spam engellemek için kabul edilebilir.
 *
 * INCR + ilk istekte EXPIRE tek turda (Lua) yapılır: iki ayrı komut arasında
 * süreç ölürse anahtar TTL'siz kalır ve kullanıcı kalıcı olarak kilitlenirdi.
 */

import type { Redis } from 'ioredis';
import { RateLimits, type RateLimitKey } from '@tuscord/shared';
import { RedisKeys } from './redisKeys.js';
import { Errors } from './errors.js';

const SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Saniye cinsinden pencerenin bitişine kalan süre. */
  resetAfter: number;
  limit: number;
}

export interface RateLimiterOptions {
  /** Test edilebilirlik için: gerçek bir Redis yerine sahte istemci verilebilir. */
  redis: Pick<Redis, 'eval'>;
  /**
   * Bu değerlerle eşleşen `subject` için sınır hiç uygulanmaz — sayaç dahi
   * artmaz. `subject` genelde IP olduğundan pratikte "güvenilir IP" demektir;
   * kullanıcı id'siyle çağrılan kovalarda da aynı listeye bakılır (ör.
   * geliştiricinin kendi hesabıyla mesaj/davet limitini aşabilmesi).
   */
  trustedSubjects?: ReadonlySet<string>;
}

export class RateLimiter {
  constructor(private readonly options: RateLimiterOptions) {}

  /**
   * @param bucket  RateLimits içindeki kural adı
   * @param subject Sayacın kime ait olduğu — IP, kullanıcı id'si, veya `${userId}:${channelId}`
   */
  async check(bucket: RateLimitKey, subject: string): Promise<RateLimitResult> {
    const [limit, windowSeconds] = RateLimits[bucket];

    if (this.options.trustedSubjects?.has(subject)) {
      return { allowed: true, remaining: limit, resetAfter: 0, limit };
    }

    const key = RedisKeys.rateLimit(bucket, subject);

    const [count, ttl] = (await this.options.redis.eval(
      SCRIPT,
      1,
      key,
      String(windowSeconds),
    )) as [number, number];

    // TTL -1 (süresiz) beklenmez ama olursa pencereyi tam kabul et; kilitli kalmasın.
    const resetAfter = ttl >= 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAfter,
      limit,
    };
  }

  /** Sınır aşıldıysa 429 fırlatır. Rota içinde tek satırda kullanım için. */
  async consume(bucket: RateLimitKey, subject: string): Promise<RateLimitResult> {
    const result = await this.check(bucket, subject);
    if (!result.allowed) throw Errors.rateLimited(result.resetAfter);
    return result;
  }
}

/**
 * Kanal yavaş modu — hız sınırından ayrıdır: süre kanal ayarından gelir
 * ve sayaç değil, "son gönderimden bu yana geçen süre" mantığı çalışır.
 */
export async function checkSlowmode(
  redis: Pick<Redis, 'set' | 'ttl'>,
  channelId: string,
  userId: string,
  slowmodeSeconds: number,
): Promise<void> {
  if (slowmodeSeconds <= 0) return;
  const key = RedisKeys.slowmode(channelId, userId);
  // NX: yalnızca anahtar yoksa yaz. Yazabildiysek kullanıcı serbest.
  const ok = await redis.set(key, '1', 'EX', slowmodeSeconds, 'NX');
  if (ok === null) {
    const ttl = await redis.ttl(key);
    throw Errors.rateLimited(ttl > 0 ? ttl : slowmodeSeconds);
  }
}
