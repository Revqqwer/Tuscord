import { Redis } from 'ioredis';
import { env } from './env.js';

/**
 * Üç ayrı bağlantı:
 *  - `redis`      genel komutlar (oturum, presence, hız sınırı)
 *  - `publisher`  gateway olay yayını
 *  - `subscriber` abonelik modundaki bağlantı başka komut kabul edemez, bu yüzden ayrı
 *
 * Faz 1'de tek gateway düğümü çalışacak ama pub/sub baştan devrede:
 * ikinci düğümü sonradan eklemek, tasarımı sonradan değiştirmekten ucuz.
 */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Anahtar adları saf sabittir ve bağlantıdan bağımsız import edilebilir.
export { RedisKeys, PubSubChannels } from './lib/redisKeys.js';

export async function closeRedis(): Promise<void> {
  await Promise.all([redis.quit(), publisher.quit(), subscriber.quit()]);
}
