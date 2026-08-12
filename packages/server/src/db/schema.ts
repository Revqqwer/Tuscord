/**
 * Veritabanı şeması — PROJE-SPEC Bölüm 4.
 *
 * Kurallar:
 *  - Tüm birincil anahtarlar Snowflake (BIGINT). Auto-increment yok.
 *  - Tüm zaman damgaları timestamptz, UTC.
 *  - İzin bitfield'ları BIGINT (Postgres'te işaretli 64-bit; 25 iznimiz 63 bite rahat sığar).
 *  - Spec'te `GuildMember.roles[]` dizi olarak yazılmıştı; bunun yerine ayrı bir
 *    junction tablosu (member_roles) kullanıyoruz: "bu rolü kimler taşıyor"
 *    sorgusu rol silmede ve üye listesi filtrelemede indeksli çalışsın diye.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/** Snowflake sütunu kısayolu — her yerde aynı tip. */
const snowflake = (name: string) => bigint(name, { mode: 'bigint' });
/**
 * İzin bitfield sütunu.
 * Varsayılan `sql`0`` ile veriliyor: drizzle-kit şema anlık görüntüsünü
 * JSON'a yazarken bigint literal'ini (`0n`) serialize edemiyor.
 */
const permissionBits = (name: string) => bigint(name, { mode: 'bigint' });
const ZERO = sql`0`;
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* ------------------------------------------------------------------ */
/* Kullanıcılar ve oturumlar                                           */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: snowflake('id').primaryKey(),
    username: varchar('username', { length: 32 }).notNull(),
    /** 4 haneli, kullanıcı adı içinde benzersizliği sağlar (hakan#0042). */
    discriminator: varchar('discriminator', { length: 4 }).notNull(),
    displayName: varchar('display_name', { length: 32 }),
    email: varchar('email', { length: 254 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    bio: varchar('bio', { length: 190 }),
    locale: varchar('locale', { length: 5 }).notNull().default('tr'),
    isBot: boolean('is_bot').notNull().default(false),
    isDisabled: boolean('is_disabled').notNull().default(false),
    /** Platform yöneticisi: tüm kullanıcı/sunucu listesini görür, her sunucuya girebilir. */
    isAdmin: boolean('is_admin').notNull().default(false),
    /** TOTP secret; null ise MFA kapalı. At-rest şifrelenmiş saklanır. */
    mfaSecret: text('mfa_secret'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** KVKK silme talebi işlendiğinde doldurulur; kayıt anonimleştirilir. */
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('users_username_discriminator_key').on(t.username, t.discriminator),
    uniqueIndex('users_email_key').on(t.email),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: snowflake('id').primaryKey(),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ham token asla saklanmaz — yalnızca SHA-256 özeti. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/** E-posta doğrulama ve parola sıfırlama tek tabloda. */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: snowflake('id').primaryKey(),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'email_verify' | 'password_reset' */
    purpose: varchar('purpose', { length: 20 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [
    uniqueIndex('verification_tokens_hash_key').on(t.tokenHash),
    index('verification_tokens_user_idx').on(t.userId, t.purpose),
  ],
);

/* ------------------------------------------------------------------ */
/* Sunucular, roller, üyelik                                           */
/* ------------------------------------------------------------------ */

export const guilds = pgTable(
  'guilds',
  {
    id: snowflake('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    iconUrl: text('icon_url'),
    bannerUrl: text('banner_url'),
    ownerId: snowflake('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    description: varchar('description', { length: 300 }),
    systemChannelId: snowflake('system_channel_id'),
    /** Sunucu genelinde engellenen kelimeler (moderasyon). */
    wordFilter: jsonb('word_filter').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Raid koruması: hesap yaşı (saat) ve doğrulanmış e-posta zorunluluğu. */
    minAccountAgeHours: integer('min_account_age_hours').notNull().default(0),
    requireVerifiedEmail: boolean('require_verified_email').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // İsimle katılabilmek için isim benzersiz olmalı; büyük/küçük harf duyarsız.
    uniqueIndex('guilds_name_lower_key').on(sql`lower(${t.name})`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    /** @everyone rolünün id'si guild.id ile aynıdır — Discord modeli. */
    id: snowflake('id').primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    /** 0xRRGGBB; 0 = renksiz. */
    color: integer('color').notNull().default(0),
    /** Hiyerarşi. @everyone her zaman 0. Büyük olan üstte. */
    position: integer('position').notNull().default(0),
    permissions: permissionBits('permissions').notNull().default(ZERO),
    hoist: boolean('hoist').notNull().default(false),
    mentionable: boolean('mentionable').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('roles_guild_position_idx').on(t.guildId, t.position)],
);

export const guildMembers = pgTable(
  'guild_members',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 32 }),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    /** Gelecekteki tarih → üye timeout'ta. Bkz. computePermissions adım 6. */
    timeoutUntil: ts('timeout_until'),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    // Spec'in istediği indeks; PK zaten (guild_id, user_id) — ters yön için ayrı indeks:
    index('guild_members_user_idx').on(t.userId),
  ],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    guildId: snowflake('guild_id').notNull(),
    userId: snowflake('user_id').notNull(),
    roleId: snowflake('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.roleId] }),
    index('member_roles_role_idx').on(t.roleId),
  ],
);

/* ------------------------------------------------------------------ */
/* Kanallar ve izin overwrite'ları                                     */
/* ------------------------------------------------------------------ */

export const channels = pgTable(
  'channels',
  {
    id: snowflake('id').primaryKey(),
    /** DM ve grup DM için null. */
    guildId: snowflake('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    /** ChannelType: 0 metin, 1 DM, 2 ses, 3 grup DM, 4 kategori. */
    type: smallint('type').notNull(),
    name: varchar('name', { length: 100 }),
    topic: varchar('topic', { length: 1024 }),
    position: integer('position').notNull().default(0),
    /** Kategori kanalı. */
    parentId: snowflake('parent_id'),
    slowmodeSeconds: integer('slowmode_seconds').notNull().default(0),
    nsfw: boolean('nsfw').notNull().default(false),
    /** Moderasyon: kanal kilidi (SEND_MESSAGES herkese kapalı). */
    locked: boolean('locked').notNull().default(false),
    lastMessageId: snowflake('last_message_id'),
    /** Grup DM sahibi. */
    ownerId: snowflake('owner_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('channels_guild_position_idx').on(t.guildId, t.position)],
);

/** DM ve grup DM katılımcıları. */
export const channelRecipients = pgTable(
  'channel_recipients',
  {
    channelId: snowflake('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Kullanıcı DM'i "kapattığında" kanal silinmez, gizlenir. */
    closed: boolean('closed').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_recipients_user_idx').on(t.userId),
  ],
);

export const permissionOverwrites = pgTable(
  'permission_overwrites',
  {
    channelId: snowflake('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    /** Rol id'si veya kullanıcı id'si. */
    targetId: snowflake('target_id').notNull(),
    /** 'role' | 'member' */
    targetType: varchar('target_type', { length: 6 }).notNull(),
    allow: permissionBits('allow').notNull().default(ZERO),
    deny: permissionBits('deny').notNull().default(ZERO),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.targetId, t.targetType] })],
);

/* ------------------------------------------------------------------ */
/* Mesajlar                                                            */
/* ------------------------------------------------------------------ */

export const messages = pgTable(
  'messages',
  {
    id: snowflake('id').primaryKey(),
    channelId: snowflake('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    /** Denormalize: kanal→sunucu JOIN'i olmadan yetkilendirme ve olay yönlendirme. */
    guildId: snowflake('guild_id'),
    authorId: snowflake('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: varchar('content', { length: 4000 }).notNull().default(''),
    /** MessageType. */
    type: smallint('type').notNull().default(0),
    replyToId: snowflake('reply_to_id'),
    pinned: boolean('pinned').notNull().default(false),
    mentionEveryone: boolean('mention_everyone').notNull().default(false),
    mentions: jsonb('mentions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    mentionRoles: jsonb('mention_roles').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
    editedAt: ts('edited_at'),
    /** Yumuşak silme: moderasyon incelemesi ve 5651 kayıt yükümlülüğü için. */
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    // Mesaj listesi bu indekse dayanır. Kürsörlü sayfalama: WHERE channel_id=? AND id < ? ORDER BY id DESC
    index('messages_channel_id_idx').on(t.channelId, t.id.desc()),
    index('messages_author_idx').on(t.authorId, t.id.desc()),
    // Tam metin arama. 'simple' sözlük: Postgres'te Türkçe stemmer yok,
    // 'turkish' yapılandırması varsayılan kurulumda bulunmaz.
    index('messages_content_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${t.content})`,
    ),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: snowflake('id').primaryKey(),
    messageId: snowflake('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    uploaderId: snowflake('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    contentType: varchar('content_type', { length: 128 }).notNull(),
    /** R2'deki tahmin edilemez nesne yolu. */
    objectKey: text('object_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** 'pending' | 'clean' | 'flagged' — CSAM/kötücül içerik taraması sonucu. */
    scanStatus: varchar('scan_status', { length: 10 }).notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('attachments_message_idx').on(t.messageId),
    index('attachments_scan_status_idx').on(t.scanStatus),
  ],
);

export const reactions = pgTable(
  'reactions',
  {
    messageId: snowflake('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Unicode emoji. Özel emoji Faz 1.5. */
    emoji: varchar('emoji', { length: 64 }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/**
 * Arkadaşlık ilişkileri.
 *
 * Tek satır bir ilişkiyi temsil eder: `requesterId` isteği gönderen,
 * `addresseeId` alan. `status`:
 *   'pending'  — istek gönderildi, henüz kabul edilmedi
 *   'accepted' — arkadaşlar
 *
 * Yön önemli: yalnızca `addresseeId` isteği kabul edebilir. Arkadaş listesi
 * için iki yön de sorgulanır (requester=ben VEYA addressee=ben, status=accepted).
 */
export const friendships = pgTable(
  'friendships',
  {
    requesterId: snowflake('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: snowflake('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'pending' | 'accepted' */
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    index('friendships_addressee_idx').on(t.addresseeId, t.status),
    index('friendships_requester_idx').on(t.requesterId, t.status),
  ],
);

/** Okunmamış sayacı: kullanıcının kanalda en son okuduğu mesaj. */
export const readStates = pgTable(
  'read_states',
  {
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: snowflake('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadMessageId: snowflake('last_read_message_id'),
    /** Bahsedilme sayacı — okundu işaretlenene kadar artar. */
    mentionCount: integer('mention_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

/* ------------------------------------------------------------------ */
/* Davetler ve yasaklar                                                */
/* ------------------------------------------------------------------ */

export const invites = pgTable(
  'invites',
  {
    code: varchar('code', { length: 12 }).primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: snowflake('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    inviterId: snowflake('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    uses: integer('uses').notNull().default(0),
    /** null = sınırsız. */
    maxUses: integer('max_uses'),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('invites_guild_idx').on(t.guildId)],
);

export const bans = pgTable(
  'bans',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: snowflake('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moderatorId: snowflake('moderator_id').notNull(),
    reason: varchar('reason', { length: 512 }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

/* ------------------------------------------------------------------ */
/* Moderasyon ve uyum                                                  */
/* ------------------------------------------------------------------ */

export const auditLog = pgTable(
  'audit_log',
  {
    id: snowflake('id').primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorId: snowflake('actor_id').notNull(),
    actionType: varchar('action_type', { length: 40 }).notNull(),
    targetId: snowflake('target_id'),
    changes: jsonb('changes').$type<Record<string, { before: unknown; after: unknown }>>(),
    reason: varchar('reason', { length: 512 }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_guild_idx').on(t.guildId, t.id.desc())],
);

export const reports = pgTable(
  'reports',
  {
    id: snowflake('id').primaryKey(),
    reporterId: snowflake('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'message' | 'user' | 'guild' */
    targetType: varchar('target_type', { length: 10 }).notNull(),
    targetId: snowflake('target_id').notNull(),
    /** Rapor edilen içeriğin anlık kopyası — içerik silinse de inceleme yapılabilsin. */
    snapshot: jsonb('snapshot'),
    reason: varchar('reason', { length: 1000 }).notNull(),
    /** 'open' | 'in_review' | 'resolved' | 'dismissed' */
    status: varchar('status', { length: 12 }).notNull().default('open'),
    handledBy: snowflake('handled_by'),
    handledAt: ts('handled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.id.desc()),
    index('reports_target_idx').on(t.targetType, t.targetId),
  ],
);

/**
 * 5651 sayılı kanun — yer sağlayıcı trafik bilgisi kaydı.
 *
 * Türkiye'de barındırma kararı verildiği için bu tablo zorunlu.
 * İçerik DEĞİL, yalnızca erişim üstverisi tutulur. Saklama süresi
 * TRAFFIC_LOG_RETENTION_DAYS (varsayılan 365 gün); süresi dolan kayıtlar
 * zamanlanmış görevle silinir — KVKK'nın "gerektiğinden uzun saklamama"
 * ilkesiyle 5651'in asgari süresi ancak böyle birlikte karşılanır.
 */
export const trafficLogs = pgTable(
  'traffic_logs',
  {
    id: snowflake('id').primaryKey(),
    userId: snowflake('user_id'),
    /** 'login' | 'logout' | 'register' | 'upload' | 'session_resume' */
    eventType: varchar('event_type', { length: 20 }).notNull(),
    ip: varchar('ip', { length: 45 }).notNull(),
    /** Taşıyıcı NAT arkasındaki abonenin ayırt edilmesi için port da gerekir. */
    sourcePort: integer('source_port'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('traffic_logs_created_idx').on(t.createdAt),
    index('traffic_logs_user_idx').on(t.userId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Guild = typeof guilds.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type GuildMember = typeof guildMembers.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
