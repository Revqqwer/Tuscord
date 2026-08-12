/**
 * Redis anahtar ve pub/sub kanal adları.
 *
 * Bağlantı kuran `redis.ts`'ten ayrı tutuluyor: bu dosya saf sabitlerden
 * ibaret, import edilmesi bir Redis bağlantısı açmaz ve ortam değişkeni
 * gerektirmez. Testlerin gerçek altyapı olmadan çalışabilmesi buna bağlı.
 */

export const RedisKeys = {
  session: (tokenHash: string) => `session:${tokenHash}`,
  presence: (userId: string) => `presence:${userId}`,
  /** Kullanıcının açık gateway bağlantıları (çok cihaz). */
  userConnections: (userId: string) => `conn:${userId}`,
  gatewaySession: (sessionId: string) => `gwsession:${sessionId}`,
  rateLimit: (bucket: string, subject: string) => `rl:${bucket}:${subject}`,
  slowmode: (channelId: string, userId: string) => `slow:${channelId}:${userId}`,
  typing: (channelId: string, userId: string) => `typing:${channelId}:${userId}`,
} as const;

/** Olaylar sunucu bazında dağıtılır, alıcı tarafta izne göre süzülür. */
export const PubSubChannels = {
  guild: (guildId: string) => `evt:guild:${guildId}`,
  /** DM ve kullanıcıya özel olaylar (PRESENCE_UPDATE dahil). */
  user: (userId: string) => `evt:user:${userId}`,
} as const;
