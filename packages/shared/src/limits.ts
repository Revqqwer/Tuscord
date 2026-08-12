/**
 * Ortak sınırlar ve doğrulama kuralları.
 * İstemci ve sunucu AYNI değerleri kullanır — istemcide sayaç gösterip
 * sunucuda farklı bir sınır uygulamak kötü bir kullanıcı deneyimidir.
 *
 * Sunucu bunları yine de kendi doğrulamasında zorunlu tutar; istemci
 * doğrulaması yalnızca kolaylıktır, güvenlik sınırı değildir.
 */

export const Limits = {
  USERNAME_MIN: 2,
  USERNAME_MAX: 32,
  DISPLAY_NAME_MAX: 32,
  NICKNAME_MAX: 32,
  BIO_MAX: 190,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,

  GUILD_NAME_MIN: 2,
  GUILD_NAME_MAX: 100,
  GUILD_DESCRIPTION_MAX: 300,
  CHANNEL_NAME_MIN: 1,
  CHANNEL_NAME_MAX: 100,
  CHANNEL_TOPIC_MAX: 1024,
  ROLE_NAME_MAX: 100,

  MESSAGE_MAX: 4000,
  MESSAGE_FETCH_LIMIT: 100,
  MESSAGE_BULK_DELETE_MAX: 100,
  ATTACHMENTS_PER_MESSAGE: 10,
  ATTACHMENT_SIZE_MAX: 25 * 1024 * 1024,
  AVATAR_SIZE_MAX: 8 * 1024 * 1024,

  SLOWMODE_MAX_SECONDS: 21_600, // 6 saat
  TIMEOUT_MAX_DAYS: 28,

  GUILDS_PER_USER: 100,
  CHANNELS_PER_GUILD: 200,
  ROLES_PER_GUILD: 100,
  REACTIONS_PER_MESSAGE: 20,
  GROUP_DM_RECIPIENTS_MAX: 10,
} as const;

/**
 * Hız sınırları: [istek sayısı, pencere saniyesi].
 * Redis'te sabit pencere sayacı olarak uygulanır.
 */
export const RateLimits = {
  /** IP başına — kaba kuvvet parola denemesi. */
  AUTH_LOGIN: [10, 300],
  AUTH_REGISTER: [5, 3600],
  AUTH_PASSWORD_RESET: [3, 3600],
  /** Kullanıcı + kanal başına. Kanal yavaş modu bunun ÜSTÜNE uygulanır. */
  MESSAGE_CREATE: [10, 5],
  MESSAGE_EDIT: [10, 5],
  REACTION_ADD: [20, 10],
  TYPING: [5, 10],
  /** Kullanıcı başına. */
  INVITE_CREATE: [10, 600],
  ATTACHMENT_UPLOAD: [20, 600],
  SEARCH: [20, 60],
  GUILD_CREATE: [5, 3600],
  REPORT_CREATE: [10, 3600],
  /** Tüm uçlar için kullanıcı başına genel tavan. */
  GLOBAL: [100, 10],
} as const satisfies Record<string, readonly [number, number]>;

export type RateLimitKey = keyof typeof RateLimits;

/**
 * Kullanıcı adı kuralları: küçük harf, rakam, alt çizgi, nokta.
 * Discriminator ile birlikte benzersizdir (ör. `hakan#0042`).
 * Türkçe karakterler kasıtlı olarak dışarıda — ı/i ve I/İ karşılaştırması
 * taklit hesap (homoglif) saldırısına açık kapı bırakıyor.
 */
export const USERNAME_PATTERN = /^[a-z0-9_.]{2,32}$/;

/** Kanal adı: Discord gibi küçük harf ve tire. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9\-_çğıöşü]{1,100}$/;

export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function normalizeChannelName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_çğıöşü]/g, '')
    .slice(0, Limits.CHANNEL_NAME_MAX);
}
