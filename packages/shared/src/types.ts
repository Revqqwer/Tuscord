/**
 * API sınırında taşınan veri şekilleri (DTO).
 *
 * Kural: Snowflake'ler ve izin bitfield'ları JSON'da HER ZAMAN string'dir.
 * JS number 64 biti tutamaz; bigint JSON.stringify edilemez.
 */

import type { Snowflake } from './snowflake.js';

/** Discord'un numaralandırması korunuyor — referans karşılaştırması kolay olsun. */
export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2, // Faz 2
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const MessageType = {
  DEFAULT: 0,
  MEMBER_JOIN: 1,
  CHANNEL_PINNED_MESSAGE: 2,
  REPLY: 19,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const PresenceStatus = {
  ONLINE: 'online',
  IDLE: 'idle',
  DND: 'dnd',
  OFFLINE: 'offline',
  /**
   * Yalnızca istemciden sunucuya GİDER (bkz. IdentifyPayload/PRESENCE_UPDATE
   * op'u) — başkalarına ASLA bu değerle yayınlanmaz, sunucu bunu 'offline'a
   * çevirip yayınlar (bkz. server gateway/index.ts setPresence). Kendi
   * istemcim "görünmez" seçtiğimi bilir, başkaları çevrimdışı görür.
   */
  INVISIBLE: 'invisible',
} as const;
export type PresenceStatus = (typeof PresenceStatus)[keyof typeof PresenceStatus];

export interface PublicUser {
  id: Snowflake;
  username: string;
  discriminator: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isBot: boolean;
}

/** Yalnızca kullanıcının kendisine döner — e-posta gibi alanlar burada. */
export interface SelfUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  locale: string;
  /** Platform yöneticisi mi — admin panelini yalnızca buna göster. */
  isAdmin: boolean;
}

/**
 * Bot uygulaması — Discord'daki "Application" karşılığı. Bir insan
 * kullanıcı bunu yönetir (`ownerId`); arkasındaki gerçek kimlik ise ayrı,
 * `isBot: true` bir kullanıcı satırıdır (`botUser`) — sunucuya normal bir
 * üye gibi eklenir, mesaj/izin sistemi hiç değişmeden çalışır.
 */
export interface APIBotApplication {
  id: Snowflake;
  ownerId: Snowflake;
  name: string;
  botUser: PublicUser;
  createdAt: string;
}

/** Bot oluşturma/token yenileme cevabı — ham token yalnızca BURADA, bir kez döner. */
export interface APIBotApplicationWithToken extends APIBotApplication {
  token: string;
}

export interface APIRole {
  id: Snowflake;
  guildId: Snowflake;
  name: string;
  color: number;
  position: number;
  /** BIGINT bitfield, string olarak. */
  permissions: string;
  hoist: boolean;
  mentionable: boolean;
}

export interface APIPermissionOverwrite {
  targetId: Snowflake;
  targetType: 'role' | 'member';
  allow: string;
  deny: string;
}

export interface APIChannel {
  id: Snowflake;
  guildId: Snowflake | null;
  type: ChannelType;
  name: string | null;
  topic: string | null;
  position: number;
  parentId: Snowflake | null;
  slowmodeSeconds: number;
  nsfw: boolean;
  /** Moderatör kanalı kilitledi: MANAGE_CHANNELS olmadan yazılamaz. */
  locked: boolean;
  lastMessageId: Snowflake | null;
  /** Yalnızca sesli kanal — elle seçilmiş sticker; null ise kanal id'sinden türetilen varsayılan kullanılır. */
  sticker: string | null;
  /** Yalnızca MANAGE_CHANNELS iznine sahip istemcilere gönderilir. */
  overwrites?: APIPermissionOverwrite[];
  /** DM ve grup DM için. */
  recipients?: PublicUser[];
}

export interface APIGuild {
  id: Snowflake;
  name: string;
  iconUrl: string | null;
  bannerUrl: string | null;
  ownerId: Snowflake;
  description: string | null;
  systemChannelId: Snowflake | null;
  createdAt: string;
}

export interface APIGuildMember {
  guildId: Snowflake;
  user: PublicUser;
  nickname: string | null;
  roles: Snowflake[];
  joinedAt: string;
  timeoutUntil: string | null;
}

export interface APIAttachment {
  id: Snowflake;
  filename: string;
  size: number;
  contentType: string;
  /** İndirme bağlantısı — tarayıcı dosyayı çalıştırmaz, indirir. */
  url: string;
  /** Yalnızca görsellerde: satır içi gösterilebilir bağlantı. */
  previewUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface APIReaction {
  emoji: string;
  count: number;
  /** İsteği yapan kullanıcı bu tepkiyi vermiş mi. */
  me: boolean;
}

export interface APIMessage {
  id: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
  author: PublicUser;
  content: string;
  createdAt: string;
  editedAt: string | null;
  replyToId: Snowflake | null;
  pinned: boolean;
  type: MessageType;
  attachments: APIAttachment[];
  reactions: APIReaction[];
  mentions: Snowflake[];
  mentionRoles: Snowflake[];
  mentionEveryone: boolean;
}

export interface APIInvite {
  code: string;
  guildId: Snowflake;
  channelId: Snowflake;
  inviterId: Snowflake;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface APIBan {
  guildId: Snowflake;
  user: PublicUser;
  moderatorId: Snowflake;
  reason: string | null;
  createdAt: string;
}

export const AuditLogAction = {
  GUILD_UPDATE: 'guild_update',
  CHANNEL_CREATE: 'channel_create',
  CHANNEL_UPDATE: 'channel_update',
  CHANNEL_DELETE: 'channel_delete',
  CHANNEL_OVERWRITE_UPDATE: 'channel_overwrite_update',
  ROLE_CREATE: 'role_create',
  ROLE_UPDATE: 'role_update',
  ROLE_DELETE: 'role_delete',
  MEMBER_KICK: 'member_kick',
  MEMBER_BAN: 'member_ban',
  MEMBER_UNBAN: 'member_unban',
  MEMBER_TIMEOUT: 'member_timeout',
  MEMBER_ROLE_UPDATE: 'member_role_update',
  MEMBER_NICKNAME_UPDATE: 'member_nickname_update',
  MESSAGE_DELETE: 'message_delete',
  MESSAGE_BULK_DELETE: 'message_bulk_delete',
  INVITE_CREATE: 'invite_create',
  INVITE_DELETE: 'invite_delete',
  REPORT_HANDLED: 'report_handled',
} as const;
export type AuditLogAction = (typeof AuditLogAction)[keyof typeof AuditLogAction];

export interface APIAuditLogEntry {
  id: Snowflake;
  guildId: Snowflake;
  actorId: Snowflake;
  actionType: AuditLogAction;
  targetId: Snowflake | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  reason: string | null;
  createdAt: string;
}

export const ReportStatus = {
  OPEN: 'open',
  IN_REVIEW: 'in_review',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export interface APIReport {
  id: Snowflake;
  reporterId: Snowflake;
  targetType: 'message' | 'user' | 'guild';
  targetId: Snowflake;
  reason: string;
  status: ReportStatus;
  handledBy: Snowflake | null;
  createdAt: string;
}

export const FriendStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
} as const;
export type FriendStatus = (typeof FriendStatus)[keyof typeof FriendStatus];

export interface APIFriendship {
  /** Karşı taraf. */
  user: PublicUser;
  status: FriendStatus;
  /** pending ise: 'incoming' = bana istek geldi, 'outgoing' = ben gönderdim. */
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

/** Engellediğim bir kullanıcı — yalnızca tek yönlü, ben → onlar. */
export interface APIBlock {
  user: PublicUser;
  createdAt: string;
}

/** Hata gövdesi — tüm uçlar hata durumunda bu şekli döner. */
export interface APIError {
  error: string;
  /** Makine tarafından okunur kod; istemci buna göre mesaj gösterir. */
  code: string;
  /** Alan bazlı doğrulama hataları. */
  fields?: Record<string, string>;
  /** 429 durumunda saniye cinsinden bekleme. */
  retryAfter?: number;
}
