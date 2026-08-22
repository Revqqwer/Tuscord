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

  GUILD_NAME_MIN: 3,
  GUILD_NAME_MAX: 20,
  GUILD_DESCRIPTION_MAX: 300,
  CHANNEL_NAME_MIN: 3,
  CHANNEL_NAME_MAX: 20,
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

  BOT_APPS_PER_USER: 25,
  BOT_NAME_MAX: 32,
} as const;

/**
 * Hız sınırları: [istek sayısı, pencere saniyesi].
 * Redis'te sabit pencere sayacı olarak uygulanır.
 */
export const RateLimits = {
  /** IP başına — kaba kuvvet parola denemesi. */
  AUTH_LOGIN: [10, 300],
  AUTH_REGISTER: [10, 3600],
  AUTH_PASSWORD_RESET: [3, 3600],
  AUTH_RESEND_VERIFY: [3, 3600],
  TICKET_CREATE: [5, 3600],
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
export const CHANNEL_NAME_PATTERN = /^[a-z0-9\-_çğıöşü]{3,20}$/;

/**
 * Sunucu ve kanal adlarında izin verilen karakterler: harf (Türkçe dahil),
 * rakam, boşluk, tire, alt çizgi. `! @ # \ /` gibi semboller ikisinde de
 * reddedilir.
 *
 * Kural ortak, sonrası farklı: kanal adı ayrıca slug'a çevrilir (küçük harf,
 * boşluk → tire), sunucu adı olduğu gibi saklanır — kullanıcıya gösterilen
 * bir başlıktır ("Benim Sunucum").
 */
const NAME_ALLOWED = /^[\p{L}\p{N} \-_]+$/u;

export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

/**
 * E-posta biçimi — istemcide anında geri bildirim için. Kasıtlı olarak basit:
 * RFC 5322'yi tam karşılayan bir ifade okunaksızdır ve gerçek adresleri
 * eler. Asıl kontroller sunucuda: zod `.email()`, ardından alan adının MX
 * kaydı, ardından doğrulama e-postası.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Parola gücü: en az 1 büyük harf, 1 küçük harf, 1 rakam — uzunluk (PASSWORD_MIN/MAX)
 * AYRI kontrol edilir, burası yalnızca karakter çeşitliliğine bakar.
 */
const PASSWORD_UPPER = /[A-ZÇĞİÖŞÜ]/;
const PASSWORD_LOWER = /[a-zçğıöşü]/;
const PASSWORD_DIGIT = /[0-9]/;

export function isStrongPassword(value: string): boolean {
  return PASSWORD_UPPER.test(value) && PASSWORD_LOWER.test(value) && PASSWORD_DIGIT.test(value);
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/**
 * Kanal adı: kenar boşlukları kırpılır, iç boşluklar teke indirilir —
 * `normalizeGuildName` ile aynı kural. Artık slug'a ÇEVRİLMEZ: büyük harf
 * ve boşluk olduğu gibi korunur (eskiden küçük harfe çevrilip boşluklar
 * tireyle değiştiriliyordu).
 */
export function normalizeChannelName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Ad doğrulama hatası; istemcide `channel.errors.*` çeviri anahtarı. */
export type NameError = 'invalid_chars' | 'too_short' | 'too_long' | null;

/**
 * Kanal adı reddedilme sebebi — `null` ise ad geçerli. `guildNameError` ile
 * aynı kural: geçersiz karakterler SESSİZCE SİLİNMEZ, reddedilir —
 * kullanıcı "genel!" yazdığında adın sessizce "genel" olması sürpriz olur.
 */
export function channelNameError(value: string): NameError {
  const normalized = normalizeChannelName(value);
  if (normalized.length === 0) return 'too_short';
  if (!NAME_ALLOWED.test(normalized)) return 'invalid_chars';
  if (normalized.length < Limits.CHANNEL_NAME_MIN) return 'too_short';
  if (normalized.length > Limits.CHANNEL_NAME_MAX) return 'too_long';
  return null;
}

export function isValidChannelName(value: string): boolean {
  return channelNameError(value) === null;
}

/** Sunucu adı: kenar boşlukları kırpılır, iç boşluklar teke indirilir. */
export function normalizeGuildName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Sunucu adı reddedilme sebebi — `null` ise geçerli.
 *
 * Kanal adıyla AYNI hata türlerini ve AYNI karakter kuralını (`NAME_ALLOWED`)
 * kullanır ki iki ekran aynı uyarı metinlerini ve aynı akışı paylaşsın —
 * bkz. `channelNameError`.
 */
export function guildNameError(value: string): NameError {
  const normalized = normalizeGuildName(value);
  if (normalized.length === 0) return 'too_short';
  if (!NAME_ALLOWED.test(normalized)) return 'invalid_chars';
  if (normalized.length < Limits.GUILD_NAME_MIN) return 'too_short';
  if (normalized.length > Limits.GUILD_NAME_MAX) return 'too_long';
  return null;
}

export function isValidGuildName(value: string): boolean {
  return guildNameError(value) === null;
}

/**
 * Sesli kanal "sticker"ları — kanal listesindeki hoparlör simgesinin yerini
 * alan yuvarlak rozet.
 *
 * v1 KASITLI OLARAK Unicode emoji: indirme, lisans kontrolü ya da depolama
 * gerektirmeden anında kullanılabilecek bir "koleksiyon". İleride gerçek bir
 * illüstratörden özel bir set gelirse tek değişiklik bu listeyi PNG/SVG
 * URL'lerine çevirmek olur; sunucu tarafı doğrulama ve istemci render mantığı
 * aynı kalır.
 *
 * Sunucu, gelen `sticker` alanını bu listeye karşı doğrular — keyfi metin ya
 * da URL kabul edilmez (overwrite/isim doğrulaması gibi, güvenlik sınırı
 * sunucuda).
 */
export const CHANNEL_STICKERS = [
  '🎮', '🎵', '🎨', '🚀', '🔥', '⭐', '🌙', '🎲', '🍕', '🍩',
  '🐙', '🦄', '🎧', '🌈', '⚡', '🎯', '🏆', '👾', '🎃', '🐸',
] as const;

export type ChannelSticker = (typeof CHANNEL_STICKERS)[number];

export function isValidChannelSticker(value: string): value is ChannelSticker {
  return (CHANNEL_STICKERS as readonly string[]).includes(value);
}

/**
 * Elle bir sticker seçilmediyse kanal id'sinden türetilen SABİT bir seçim
 * (gerçek rastgele değil — her render'da değişmesin).
 */
export function defaultStickerForChannel(channelId: string): ChannelSticker {
  const index = Number(BigInt(channelId) % BigInt(CHANNEL_STICKERS.length));
  return CHANNEL_STICKERS[index]!;
}
