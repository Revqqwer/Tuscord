/**
 * WebSocket gateway protokolü — Discord'un olay modeli.
 *
 * Akış:
 *   sunucu → HELLO (heartbeat_interval)
 *   istemci → IDENTIFY (token)   |   istemci → RESUME (sessionId + son seq)
 *   sunucu → READY (ilk durum)   |   sunucu → RESUMED (kaçırılan olaylar tekrar)
 *   istemci → HEARTBEAT (periyodik) → sunucu → HEARTBEAT_ACK
 *
 * Her DISPATCH paketinde artan bir `s` (sequence) vardır; RESUME bu numaradan devam eder.
 */

import type { Snowflake } from './snowflake.js';
import type {
  APIChannel,
  APIGuild,
  APIGuildMember,
  APIMessage,
  APIRole,
  PresenceStatus,
  PublicUser,
  SelfUser,
} from './types.js';

/** İstemci → sunucu ve sunucu → istemci paket tipleri (Discord opcode modeli). */
export const GatewayOp = {
  /** sunucu → istemci: olay yayını */
  DISPATCH: 0,
  /** istemci → sunucu */
  HEARTBEAT: 1,
  /** istemci → sunucu: kimlik doğrulama */
  IDENTIFY: 2,
  /** istemci → sunucu: durum güncelleme (online/idle/dnd) */
  PRESENCE_UPDATE: 3,
  /** istemci → sunucu: ses kanalına katıl/ayrıl, sustur/kulaklık kapat */
  VOICE_STATE: 4,
  /** istemci → sunucu: WebRTC sinyalini bir kullanıcıya ilet (mesh P2P) */
  VOICE_SIGNAL: 5,
  /** istemci → sunucu: kopan oturumu sürdür */
  RESUME: 6,
  /** sunucu → istemci: yeniden bağlan (RESUME denenebilir) */
  RECONNECT: 7,
  /** sunucu → istemci: oturum geçersiz (payload: resumable mı) */
  INVALID_SESSION: 9,
  /** sunucu → istemci: bağlantı açılışı */
  HELLO: 10,
  /** sunucu → istemci */
  HEARTBEAT_ACK: 11,
} as const;
export type GatewayOp = (typeof GatewayOp)[keyof typeof GatewayOp];

/**
 * Kapanış kodları. 4000-4999 aralığı uygulamaya aittir.
 * 4004/4010/4011 kalıcı hatadır — istemci yeniden denememeli.
 */
export const GatewayCloseCode = {
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTHENTICATION_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  INVALID_SEQ: 4007,
  RATE_LIMITED: 4008,
  SESSION_TIMED_OUT: 4009,
  SESSION_EXPIRED: 4010,
  ACCOUNT_DISABLED: 4011,
} as const;
export type GatewayCloseCode = (typeof GatewayCloseCode)[keyof typeof GatewayCloseCode];

export const GatewayEvent = {
  READY: 'READY',
  RESUMED: 'RESUMED',

  MESSAGE_CREATE: 'MESSAGE_CREATE',
  MESSAGE_UPDATE: 'MESSAGE_UPDATE',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  MESSAGE_BULK_DELETE: 'MESSAGE_BULK_DELETE',
  MESSAGE_REACTION_ADD: 'MESSAGE_REACTION_ADD',
  MESSAGE_REACTION_REMOVE: 'MESSAGE_REACTION_REMOVE',

  TYPING_START: 'TYPING_START',
  PRESENCE_UPDATE: 'PRESENCE_UPDATE',

  CHANNEL_CREATE: 'CHANNEL_CREATE',
  CHANNEL_UPDATE: 'CHANNEL_UPDATE',
  CHANNEL_DELETE: 'CHANNEL_DELETE',

  GUILD_CREATE: 'GUILD_CREATE',
  GUILD_UPDATE: 'GUILD_UPDATE',
  GUILD_DELETE: 'GUILD_DELETE',

  GUILD_MEMBER_ADD: 'GUILD_MEMBER_ADD',
  GUILD_MEMBER_UPDATE: 'GUILD_MEMBER_UPDATE',
  GUILD_MEMBER_REMOVE: 'GUILD_MEMBER_REMOVE',

  GUILD_ROLE_CREATE: 'GUILD_ROLE_CREATE',
  GUILD_ROLE_UPDATE: 'GUILD_ROLE_UPDATE',
  GUILD_ROLE_DELETE: 'GUILD_ROLE_DELETE',

  /** Arkadaşlık: istek geldi/güncellendi (kabul) / kaldırıldı. */
  FRIEND_UPSERT: 'FRIEND_UPSERT',
  FRIEND_REMOVE: 'FRIEND_REMOVE',

  /** Ses: bir kullanıcının ses kanalı durumu değişti (katıldı/ayrıldı/mute/deafen). */
  VOICE_STATE_UPDATE: 'VOICE_STATE_UPDATE',
  /** Ses: WebRTC sinyali (SDP/ICE) bir eşten geldi. Yalnızca hedef kullanıcıya. */
  VOICE_SIGNAL: 'VOICE_SIGNAL',
} as const;
export type GatewayEvent = (typeof GatewayEvent)[keyof typeof GatewayEvent];

/* ------------------------------------------------------------------ */
/* Paket zarfı                                                         */
/* ------------------------------------------------------------------ */

export interface GatewayPacket<T = unknown> {
  op: GatewayOp;
  /** DISPATCH ise olay adı. */
  t?: GatewayEvent;
  /** DISPATCH ise sıra numarası — RESUME bunu kullanır. */
  s?: number;
  d?: T;
}

export interface HelloPayload {
  heartbeatIntervalMs: number;
}

export interface IdentifyPayload {
  token: string;
  /** İstemci bilgisi — oturum listesinde gösterilir. */
  properties?: { os?: string; browser?: string; device?: string };
}

export interface ResumePayload {
  token: string;
  sessionId: string;
  seq: number;
}

export interface ReadyPayload {
  /** Gateway protokol sürümü. */
  v: number;
  user: SelfUser;
  sessionId: string;
  guilds: ReadyGuild[];
  /** Kullanıcının açık DM kanalları. */
  privateChannels: APIChannel[];
  /** Kanal başına okundu durumu — okunmamış rozetleri bununla çizilir. */
  readStates: ReadState[];
}

export interface ReadState {
  channelId: Snowflake;
  /** Kullanıcının bu kanalda en son okuduğu mesaj. */
  lastReadMessageId: Snowflake | null;
  /** Okunmamış bahsetme sayısı. */
  mentionCount: number;
}

/** READY tek pakette gelir — 300-1000 kullanıcı ölçeğinde parçalamaya (lazy GUILD_CREATE) gerek yok. */
export interface ReadyGuild {
  guild: APIGuild;
  /** Yalnızca kullanıcının VIEW_CHANNEL iznine sahip olduğu kanallar. */
  channels: APIChannel[];
  roles: APIRole[];
  /** İsteği yapan kullanıcının kendi üyelik kaydı. */
  member: APIGuildMember;
  memberCount: number;
  /** Kullanıcının bu sunucudaki temel izinleri (kanal overwrite'ları hariç), string bitfield. */
  permissions: string;
}

export interface InvalidSessionPayload {
  resumable: boolean;
}

/* ------------------------------------------------------------------ */
/* Olay yükleri                                                        */
/* ------------------------------------------------------------------ */

export interface MessageDeletePayload {
  id: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
}

export interface MessageBulkDeletePayload {
  ids: Snowflake[];
  channelId: Snowflake;
  guildId: Snowflake | null;
}

export interface MessageReactionPayload {
  messageId: Snowflake;
  channelId: Snowflake;
  guildId: Snowflake | null;
  userId: Snowflake;
  emoji: string;
}

export interface TypingStartPayload {
  channelId: Snowflake;
  guildId: Snowflake | null;
  userId: Snowflake;
  /** Unix saniye. İstemci ~8 sn sonra göstergeyi kaldırır. */
  timestamp: number;
}

export interface PresenceUpdatePayload {
  userId: Snowflake;
  status: PresenceStatus;
}

export interface GuildMemberRemovePayload {
  guildId: Snowflake;
  user: PublicUser;
}

export interface GuildRoleDeletePayload {
  guildId: Snowflake;
  roleId: Snowflake;
}

export interface ChannelDeletePayload {
  id: Snowflake;
  guildId: Snowflake | null;
}

/* ---- Ses (mesh P2P) ---- */

/**
 * İstemci → sunucu (VOICE_STATE op yükü).
 * channelId null ise kullanıcı ses kanalından ayrılıyor.
 */
export interface VoiceStateOp {
  channelId: Snowflake | null;
  selfMute?: boolean;
  selfDeaf?: boolean;
  /** Ekran paylaşıyor mu (video izi yayınlıyor). */
  selfVideo?: boolean;
}

/** İstemci → sunucu (VOICE_SIGNAL op yükü). Hedef kullanıcıya iletilir. */
export interface VoiceSignalOp {
  to: Snowflake;
  channelId: Snowflake;
  /** WebRTC SDP teklifi/yanıtı ya da ICE adayı (opak). */
  signal: unknown;
}

/** Sunucu → istemci: kimin hangi ses kanalında olduğu ve mute/deafen durumu. */
export interface VoiceStateUpdatePayload {
  guildId: Snowflake;
  /** null → kullanıcı ayrıldı. */
  channelId: Snowflake | null;
  userId: Snowflake;
  user: PublicUser;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
}

/** Sunucu → istemci: bir eşten gelen WebRTC sinyali. */
export interface VoiceSignalPayload {
  from: Snowflake;
  channelId: Snowflake;
  signal: unknown;
}

export interface GuildDeletePayload {
  id: Snowflake;
  /** true ise kullanıcı çıkarıldı/ayrıldı; false ise sunucu silindi. */
  removed: boolean;
}

/** Olay adı → yük tipi. İstemcideki olay yönlendiricisi bunu kullanır. */
export interface GatewayEventPayloadMap {
  [GatewayEvent.READY]: ReadyPayload;
  [GatewayEvent.RESUMED]: Record<string, never>;

  [GatewayEvent.MESSAGE_CREATE]: APIMessage;
  [GatewayEvent.MESSAGE_UPDATE]: APIMessage;
  [GatewayEvent.MESSAGE_DELETE]: MessageDeletePayload;
  [GatewayEvent.MESSAGE_BULK_DELETE]: MessageBulkDeletePayload;
  [GatewayEvent.MESSAGE_REACTION_ADD]: MessageReactionPayload;
  [GatewayEvent.MESSAGE_REACTION_REMOVE]: MessageReactionPayload;

  [GatewayEvent.TYPING_START]: TypingStartPayload;
  [GatewayEvent.PRESENCE_UPDATE]: PresenceUpdatePayload;

  [GatewayEvent.CHANNEL_CREATE]: APIChannel;
  [GatewayEvent.CHANNEL_UPDATE]: APIChannel;
  [GatewayEvent.CHANNEL_DELETE]: ChannelDeletePayload;

  [GatewayEvent.GUILD_CREATE]: ReadyGuild;
  [GatewayEvent.GUILD_UPDATE]: APIGuild;
  [GatewayEvent.GUILD_DELETE]: GuildDeletePayload;

  [GatewayEvent.GUILD_MEMBER_ADD]: APIGuildMember;
  [GatewayEvent.GUILD_MEMBER_UPDATE]: APIGuildMember;
  [GatewayEvent.GUILD_MEMBER_REMOVE]: GuildMemberRemovePayload;

  [GatewayEvent.GUILD_ROLE_CREATE]: APIRole;
  [GatewayEvent.GUILD_ROLE_UPDATE]: APIRole;
  [GatewayEvent.GUILD_ROLE_DELETE]: GuildRoleDeletePayload;

  [GatewayEvent.VOICE_STATE_UPDATE]: VoiceStateUpdatePayload;
  [GatewayEvent.VOICE_SIGNAL]: VoiceSignalPayload;
}

export const GATEWAY_VERSION = 1;
export const HEARTBEAT_INTERVAL_MS = 41_250;
/** Bu kadar süre HEARTBEAT gelmezse bağlantı zombidir, kapat. */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2;
/** Kopan oturumun RESUME için bekletilme süresi. */
export const SESSION_RESUME_WINDOW_MS = 120_000;
/** RESUME için tamponlanan olay sayısı üst sınırı (oturum başına). */
export const RESUME_BUFFER_SIZE = 500;
