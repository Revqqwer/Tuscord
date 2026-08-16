/**
 * WebSocket gateway.
 *
 * Bağlantı akışı (spec Bölüm 6):
 *   sunucu → HELLO       istemci → IDENTIFY / RESUME
 *   sunucu → READY / RESUMED
 *   istemci → HEARTBEAT  sunucu → HEARTBEAT_ACK
 *
 * Dağıtım: Redis pub/sub. Tek düğüm yeterli olsa da baştan çok düğümlü
 * yazıldı — sonradan eklemek pahalı (spec).
 */

import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { and, eq } from 'drizzle-orm';
import {
  ChannelType,
  GATEWAY_VERSION,
  GatewayCloseCode,
  GatewayEvent,
  GatewayOp,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  Permission,
  PresenceStatus,
  type GatewayPacket,
  type IdentifyPayload,
  type PublicUser,
  type ReadyGuild,
  type ResumePayload,
  type VoiceSignalOp,
  type VoiceStateOp,
  type VoiceStateUpdatePayload,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { channels, guildMembers, guilds, readStates, users } from '../db/schema.js';
import { toPublicUser } from '../services/serialize.js';
import { SESSION_COOKIE, resolveSession } from '../auth/session.js';
import { redis, subscriber, PubSubChannels, RedisKeys } from '../redis.js';
import { buildReadyGuild } from '../services/readyGuild.js';
import { loadPrivateChannels } from '../services/privateChannels.js';
import { toSelfUser } from '../services/serialize.js';
import { Connection } from './connection.js';
import type { EventEnvelope } from '../services/events.js';
import { nextIdString } from '../lib/id.js';

/**
 * Cookie başlığından tek bir değeri okur.
 * WebSocket el sıkışmasında Fastify'ın cookie eklentisi devrede değil —
 * ham başlığı kendimiz ayrıştırıyoruz.
 */
function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** Olaylar hangi izin önbelleğini geçersiz kılar. */
const INVALIDATING_EVENTS = new Set<string>([
  GatewayEvent.GUILD_ROLE_CREATE,
  GatewayEvent.GUILD_ROLE_UPDATE,
  GatewayEvent.GUILD_ROLE_DELETE,
  GatewayEvent.GUILD_MEMBER_UPDATE,
  GatewayEvent.CHANNEL_CREATE,
  GatewayEvent.CHANNEL_UPDATE,
  GatewayEvent.CHANNEL_DELETE,
  GatewayEvent.GUILD_UPDATE,
]);

export class Gateway {
  private readonly wss: WebSocketServer;
  /** sessionId → bağlantı */
  private readonly connections = new Map<string, Connection>();
  /** guildId → sessionId kümesi */
  private readonly guildIndex = new Map<string, Set<string>>();
  /** userId → sessionId kümesi (çok cihaz) */
  private readonly userIndex = new Map<string, Set<string>>();
  /**
   * userId → ses durumu. Mesh P2P sinyalleşmesi için "kim hangi kanalda"yı
   * bellekte tutuyoruz; yeni katılan mevcut roster'ı buradan öğrenir.
   * (Tek düğüm için bellek yeterli; çok düğümde Redis'e taşınmalı.)
   */
  private readonly voiceStates = new Map<
    string,
    {
      channelId: string;
      guildId: string;
      selfMute: boolean;
      selfDeaf: boolean;
      selfVideo: boolean;
      user: PublicUser;
    }
  >();
  /** Abone olunan Redis kanalları — tekrar abone olmamak için. */
  private readonly subscribed = new Set<string>();

  private heartbeatTimer?: NodeJS.Timeout;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/gateway' });
    this.wss.on('connection', (socket, request) => {
      void this.handleConnection(socket, request.headers.cookie ?? '');
    });

    subscriber.on('message', (channel, message) => {
      void this.handlePubSub(channel, message);
    });

    // Zombi bağlantı temizliği: HEARTBEAT göndermeyi bırakan istemciler
    // TCP seviyesinde açık kalabilir (mobilde uyku modu, ağ değişimi).
    this.heartbeatTimer = setInterval(() => this.sweepDeadConnections(), 30_000);
  }

  private async handleConnection(socket: import('ws').WebSocket, cookieHeader: string): Promise<void> {
    let connection: Connection | null = null;
    let identified = false;

    socket.send(
      JSON.stringify({
        op: GatewayOp.HELLO,
        d: { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS },
      } satisfies GatewayPacket),
    );

    // IDENTIFY gelmezse bağlantıyı bırakma — kimliksiz soket kaynak tüketir.
    const identifyTimeout = setTimeout(() => {
      if (!identified) socket.close(GatewayCloseCode.NOT_AUTHENTICATED, 'IDENTIFY bekleniyordu');
    }, 30_000);

    socket.on('message', async (raw) => {
      let packet: GatewayPacket;
      try {
        packet = JSON.parse(raw.toString()) as GatewayPacket;
      } catch {
        socket.close(GatewayCloseCode.DECODE_ERROR, 'Geçersiz JSON');
        return;
      }

      try {
        switch (packet.op) {
          case GatewayOp.IDENTIFY: {
            if (identified) {
              socket.close(GatewayCloseCode.ALREADY_AUTHENTICATED, 'Zaten kimlik doğrulandı');
              return;
            }
            const payload = packet.d as IdentifyPayload | undefined;
            const session = await this.authenticate(cookieHeader, payload?.token);
            if (!session) {
              socket.close(GatewayCloseCode.AUTHENTICATION_FAILED, 'Kimlik doğrulanamadı');
              return;
            }
            identified = true;
            clearTimeout(identifyTimeout);
            connection = await this.register(socket, session);
            break;
          }

          case GatewayOp.RESUME: {
            if (identified) return;
            const payload = packet.d as ResumePayload | undefined;
            if (!payload) {
              socket.close(GatewayCloseCode.DECODE_ERROR, 'RESUME yükü eksik');
              return;
            }
            const session = await this.authenticate(cookieHeader, payload.token);
            if (!session) {
              socket.close(GatewayCloseCode.AUTHENTICATION_FAILED, 'Kimlik doğrulanamadı');
              return;
            }

            const existing = this.connections.get(payload.sessionId);
            // Oturum yalnızca aynı kullanıcıya aitse sürdürülebilir.
            if (!existing || existing.userId !== session.user.id.toString()) {
              socket.send(
                JSON.stringify({ op: GatewayOp.INVALID_SESSION, d: { resumable: false } }),
              );
              socket.close(GatewayCloseCode.SESSION_EXPIRED, 'Oturum sürdürülemiyor');
              return;
            }
            if (!existing.replayFrom(payload.seq)) {
              socket.send(
                JSON.stringify({ op: GatewayOp.INVALID_SESSION, d: { resumable: false } }),
              );
              socket.close(GatewayCloseCode.INVALID_SEQ, 'Sıra numarası tampondan düşmüş');
              return;
            }
            identified = true;
            clearTimeout(identifyTimeout);
            connection = existing;
            existing.send({ op: GatewayOp.DISPATCH, t: GatewayEvent.RESUMED, s: existing.seq, d: {} });
            break;
          }

          case GatewayOp.HEARTBEAT: {
            if (connection) connection.lastHeartbeat = Date.now();
            socket.send(JSON.stringify({ op: GatewayOp.HEARTBEAT_ACK } satisfies GatewayPacket));
            break;
          }

          case GatewayOp.PRESENCE_UPDATE: {
            if (!connection) return;
            const status = (packet.d as { status?: string } | undefined)?.status;
            if (
              status === PresenceStatus.ONLINE ||
              status === PresenceStatus.IDLE ||
              status === PresenceStatus.DND
            ) {
              await this.setPresence(connection, status);
            }
            break;
          }

          case GatewayOp.VOICE_STATE: {
            if (!connection) return;
            await this.handleVoiceState(connection, packet.d as VoiceStateOp);
            break;
          }

          case GatewayOp.VOICE_SIGNAL: {
            if (!connection) return;
            this.handleVoiceSignal(connection, packet.d as VoiceSignalOp);
            break;
          }

          default:
            socket.close(GatewayCloseCode.UNKNOWN_OPCODE, 'Bilinmeyen opcode');
        }
      } catch (error) {
        console.error('[gateway] paket işlenemedi', error);
        socket.close(GatewayCloseCode.UNKNOWN_ERROR, 'Sunucu hatası');
      }
    });

    socket.on('close', () => {
      clearTimeout(identifyTimeout);
      if (connection) void this.unregister(connection);
    });

    socket.on('error', () => {
      if (connection) void this.unregister(connection);
    });
  }

  /** Cookie öncelikli; tarayıcı dışı istemciler IDENTIFY içinde token gönderebilir. */
  private async authenticate(cookieHeader: string, token?: string) {
    const value = readCookie(cookieHeader, SESSION_COOKIE) ?? token;
    if (!value) return null;
    return resolveSession(value);
  }

  private async register(
    socket: import('ws').WebSocket,
    session: NonNullable<Awaited<ReturnType<typeof resolveSession>>>,
  ): Promise<Connection> {
    const sessionId = nextIdString();
    const connection = new Connection(socket, session.user.id.toString(), sessionId);
    this.connections.set(sessionId, connection);

    const userSessions = this.userIndex.get(connection.userId) ?? new Set();
    userSessions.add(sessionId);
    this.userIndex.set(connection.userId, userSessions);
    await this.subscribeTo(PubSubChannels.user(connection.userId));

    // Kullanıcının sunucuları ve ilk durum.
    const memberships = await db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, session.user.id));

    const readyGuilds: ReadyGuild[] = [];
    for (const { guildId } of memberships) {
      const key = guildId.toString();
      const ready = await buildReadyGuild(guildId, session.user.id, this.voiceSnapshotForGuild(key));
      if (!ready) continue;
      readyGuilds.push(ready);

      connection.guildIds.add(key);
      const set = this.guildIndex.get(key) ?? new Set();
      set.add(sessionId);
      this.guildIndex.set(key, set);
      await this.subscribeTo(PubSubChannels.guild(key));
    }

    const readStateRows = await db
      .select()
      .from(readStates)
      .where(eq(readStates.userId, session.user.id));

    const privateChannels = await loadPrivateChannels(session.user.id);

    connection.dispatch(GatewayEvent.READY, {
      v: GATEWAY_VERSION,
      user: toSelfUser(session.user),
      sessionId,
      guilds: readyGuilds,
      privateChannels,
      readStates: readStateRows.map((row) => ({
        channelId: row.channelId.toString(),
        lastReadMessageId: row.lastReadMessageId?.toString() ?? null,
        mentionCount: row.mentionCount,
      })),
    });

    await this.setPresence(connection, PresenceStatus.ONLINE);
    return connection;
  }

  private async unregister(connection: Connection): Promise<void> {
    if (connection.closed) return;
    connection.closed = true;
    this.connections.delete(connection.sessionId);

    const userSessions = this.userIndex.get(connection.userId);
    userSessions?.delete(connection.sessionId);
    if (userSessions && userSessions.size === 0) {
      this.userIndex.delete(connection.userId);
      // Kullanıcının başka açık cihazı yoksa çevrimdışı.
      await redis.del(RedisKeys.presence(connection.userId));
      await this.broadcastPresence(connection.userId, PresenceStatus.OFFLINE);
      // Ses kanalındaysa ayrıldı olarak yayınla — eşler bağlantıyı kapatsın.
      await this.leaveVoice(connection.userId);
    }

    for (const guildId of connection.guildIds) {
      const set = this.guildIndex.get(guildId);
      set?.delete(connection.sessionId);
      if (set && set.size === 0) this.guildIndex.delete(guildId);
    }
  }

  private async setPresence(connection: Connection, status: string): Promise<void> {
    await redis.set(RedisKeys.presence(connection.userId), status, 'EX', 300);
    await this.broadcastPresence(connection.userId, status);
  }

  /** Durum değişikliği kullanıcının ortak olduğu tüm sunuculara gider. */
  private async broadcastPresence(userIdValue: string, status: string): Promise<void> {
    const memberships = await db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, BigInt(userIdValue)));

    const payload = { userId: userIdValue, status };
    for (const { guildId } of memberships) {
      const envelope: EventEnvelope = {
        event: GatewayEvent.PRESENCE_UPDATE,
        payload,
        guildId: guildId.toString(),
      };
      await redis.publish(PubSubChannels.guild(guildId.toString()), JSON.stringify(envelope));
    }
  }

  /* ---------------- Ses (mesh P2P) ---------------- */

  /**
   * Ses durumu değişimi: katıl / ayrıl / mute / deafen.
   *
   * Katılırken CONNECT izni kontrol edilir. Yeni katılan, kanaldaki mevcut
   * eşleri (roster) doğrudan alır ve onlara WebRTC teklifini başlatır; kanal
   * da yeni katılanı VOICE_STATE_UPDATE ile öğrenir.
   */
  private async handleVoiceState(connection: Connection, payload: VoiceStateOp): Promise<void> {
    const userIdValue = connection.userId;

    // Ayrılma.
    if (!payload || payload.channelId === null) {
      await this.leaveVoice(userIdValue);
      return;
    }

    const channelId = String(payload.channelId);
    const existing = this.voiceStates.get(userIdValue);

    // Aynı kanalda yalnızca mute/deafen/video değişimi.
    if (existing && existing.channelId === channelId) {
      existing.selfMute = payload.selfMute ?? existing.selfMute;
      existing.selfDeaf = payload.selfDeaf ?? existing.selfDeaf;
      existing.selfVideo = payload.selfVideo ?? existing.selfVideo;
      await this.broadcastVoiceState(existing);
      return;
    }

    // Kanal gerçekten sesli mi + kullanıcı bağlanabiliyor mu?
    const [channel] = await db
      .select({ guildId: channels.guildId, type: channels.type })
      .from(channels)
      .where(eq(channels.id, BigInt(channelId)))
      .limit(1);
    if (!channel?.guildId || channel.type !== ChannelType.GUILD_VOICE) return;

    const guildId = channel.guildId.toString();
    const allowed = await connection.canView(guildId, channelId, Permission.CONNECT);
    if (!allowed) return;

    // Önce eski kanaldan çık (kanal değiştirme).
    if (existing) await this.leaveVoice(userIdValue);

    const [row] = await db.select().from(users).where(eq(users.id, BigInt(userIdValue))).limit(1);
    if (!row) return;

    const state = {
      channelId,
      guildId,
      selfMute: payload.selfMute ?? false,
      selfDeaf: payload.selfDeaf ?? false,
      selfVideo: payload.selfVideo ?? false,
      user: toPublicUser(row),
    };
    this.voiceStates.set(userIdValue, state);

    // Yeni katılana kanaldaki mevcut eşleri gönder — teklifi o başlatır.
    for (const other of this.voiceStates.values()) {
      if (other.channelId === channelId && other.user.id !== userIdValue) {
        this.dispatchToUser(userIdValue, GatewayEvent.VOICE_STATE_UPDATE, {
          guildId,
          channelId,
          userId: other.user.id,
          user: other.user,
          selfMute: other.selfMute,
          selfDeaf: other.selfDeaf,
          selfVideo: other.selfVideo,
        });
      }
    }

    await this.broadcastVoiceState(state);
  }

  /**
   * Bir sunucudaki O ANKİ ses kanalı doluluğu — `buildReadyGuild`e verilir,
   * orada görünürlüğe göre süzülür (bkz. readyGuild.ts yorumu). Bağlanmadan
   * ÖNCE zaten sesli olan kullanıcılar READY'de görünsün diye (bkz.
   * ReadyGuild.voiceStates yorumu).
   */
  private voiceSnapshotForGuild(guildId: string): VoiceStateUpdatePayload[] {
    const result: VoiceStateUpdatePayload[] = [];
    for (const state of this.voiceStates.values()) {
      if (state.guildId !== guildId) continue;
      result.push({
        guildId: state.guildId,
        channelId: state.channelId,
        userId: state.user.id,
        user: state.user,
        selfMute: state.selfMute,
        selfDeaf: state.selfDeaf,
        selfVideo: state.selfVideo,
      });
    }
    return result;
  }

  /** Kullanıcıyı ses kanalından çıkar ve sunucuya ayrıldığını yayınla. */
  private async leaveVoice(userIdValue: string): Promise<void> {
    const state = this.voiceStates.get(userIdValue);
    if (!state) return;
    this.voiceStates.delete(userIdValue);
    await this.broadcastVoiceState(state, true);
  }

  /**
   * MOVE_MEMBERS ile zorla taşıma — `handleVoiceState`in tersine BİLEREK
   * CONNECT izni kontrol ETMEZ (bkz. moderation.ts voice-move yorumu: amaç
   * kanalı göremeyen bir misafiri bile taşıyabilmek). Yalnızca bu kullanıcı
   * BU düğüme bağlıysa (voiceStates'te kaydı varsa) çalışır — REST katmanı
   * olayı yalnızca hedef kullanıcıya yayınladığı için bu, o kullanıcının
   * bağlı olduğu düğümde tetiklenir (bkz. handlePubSub).
   */
  private async forceMoveVoice(userIdValue: string, channelId: string): Promise<void> {
    const existing = this.voiceStates.get(userIdValue);
    if (!existing) return; // sesli değilse taşınacak bir şey yok
    if (existing.channelId === channelId) return; // zaten o kanalda

    // Hedef kanal hâlâ gerçekten sesli mi ve aynı sunucuda mı — REST katmanı
    // zaten doğruladı, burası taşıma anına kadar silinmiş/taşınmış olma
    // ihtimaline karşı ikinci bir savunma.
    const [channel] = await db
      .select({ guildId: channels.guildId, type: channels.type })
      .from(channels)
      .where(eq(channels.id, BigInt(channelId)))
      .limit(1);
    if (!channel?.guildId || channel.type !== ChannelType.GUILD_VOICE) return;
    if (channel.guildId.toString() !== existing.guildId) return;

    await this.leaveVoice(userIdValue);

    const state = {
      channelId,
      guildId: existing.guildId,
      selfMute: existing.selfMute,
      selfDeaf: existing.selfDeaf,
      selfVideo: existing.selfVideo,
      user: existing.user,
    };
    this.voiceStates.set(userIdValue, state);

    // Yeni kanaldaki mevcut eşleri taşınan kullanıcıya gönder — teklifi o başlatır.
    for (const other of this.voiceStates.values()) {
      if (other.channelId === channelId && other.user.id !== userIdValue) {
        this.dispatchToUser(userIdValue, GatewayEvent.VOICE_STATE_UPDATE, {
          guildId: existing.guildId,
          channelId,
          userId: other.user.id,
          user: other.user,
          selfMute: other.selfMute,
          selfDeaf: other.selfDeaf,
          selfVideo: other.selfVideo,
        });
      }
    }

    await this.broadcastVoiceState(state);
  }

  /** Ses durumunu kullanıcının sunucusundaki herkese yayınla. */
  private async broadcastVoiceState(
    state: {
      channelId: string;
      guildId: string;
      selfMute: boolean;
      selfDeaf: boolean;
      selfVideo: boolean;
      user: PublicUser;
    },
    left = false,
  ): Promise<void> {
    const envelope: EventEnvelope = {
      event: GatewayEvent.VOICE_STATE_UPDATE,
      payload: {
        guildId: state.guildId,
        channelId: left ? null : state.channelId,
        userId: state.user.id,
        user: state.user,
        selfMute: state.selfMute,
        selfDeaf: state.selfDeaf,
        selfVideo: state.selfVideo,
      },
      guildId: state.guildId,
    };
    await redis.publish(PubSubChannels.guild(state.guildId), JSON.stringify(envelope));
  }

  /** WebRTC sinyalini hedef kullanıcıya ilet (yalnızca aynı kanaldaysa). */
  private handleVoiceSignal(connection: Connection, payload: VoiceSignalOp): void {
    if (!payload?.to || !payload.channelId) return;
    const sender = this.voiceStates.get(connection.userId);
    // Sinyal ancak gönderen ses kanalındaysa iletilir — kötüye kullanımı sınırlar.
    if (!sender || sender.channelId !== String(payload.channelId)) return;
    this.dispatchToUser(String(payload.to), GatewayEvent.VOICE_SIGNAL, {
      from: connection.userId,
      channelId: String(payload.channelId),
      signal: payload.signal,
    });
  }

  /** Bir olayı bir kullanıcının tüm oturumlarına gönder. */
  private dispatchToUser(userIdValue: string, event: GatewayEvent, payload: unknown): void {
    for (const sessionId of this.userIndex.get(userIdValue) ?? []) {
      this.connections.get(sessionId)?.dispatch(event, payload);
    }
  }

  private async subscribeTo(channel: string): Promise<void> {
    if (this.subscribed.has(channel)) return;
    this.subscribed.add(channel);
    await subscriber.subscribe(channel);
  }

  /* ---------------- Dağıtım ---------------- */

  private async handlePubSub(channel: string, raw: string): Promise<void> {
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw) as EventEnvelope;
    } catch {
      return;
    }

    const targets = this.resolveTargets(channel, envelope);
    for (const connection of targets) {
      if (INVALIDATING_EVENTS.has(envelope.event)) {
        connection.invalidatePermissions(envelope.guildId);
      }

      // Gizli kanalın varlığını bile sızdırma (spec Bölüm 6).
      if (envelope.guildId && envelope.channelId) {
        const required = envelope.requiredPermission
          ? BigInt(envelope.requiredPermission)
          : undefined;
        const allowed = await connection.canView(envelope.guildId, envelope.channelId, required);
        if (!allowed) continue;
      }

      connection.dispatch(envelope.event, envelope.payload);
    }

    // Üyelik değişimi abonelik haritasını da etkiler.
    if (envelope.event === GatewayEvent.GUILD_MEMBER_ADD && envelope.guildId) {
      await this.syncMembership(envelope);
    }

    // Zorla taşıma: hedef kullanıcının istemcisine olay yukarıda zaten
    // gönderildi (targets döngüsü) — burada BU düğümdeki authoritative
    // voiceStates kaydını da güncelleyip diğer katılımcılara yayınlıyoruz.
    if (envelope.event === GatewayEvent.VOICE_FORCE_MOVE) {
      const payload = envelope.payload as { userId?: string; channelId?: string } | undefined;
      if (payload?.userId && payload.channelId) {
        await this.forceMoveVoice(payload.userId, payload.channelId);
      }
    }

    // GUILD_CREATE doğrudan kullanıcıya gider (sunucu oluşturma / davetle katılma).
    // Olay zaten iletildi; burada yapılacak iş bağlantıyı yeni sunucunun
    // yayınına abone etmek — yoksa sonraki mesajlar hiç ulaşmaz.
    if (envelope.event === GatewayEvent.GUILD_CREATE && envelope.targetUserIds?.length) {
      const guildId = (envelope.payload as { guild?: { id?: string } } | undefined)?.guild?.id;
      if (guildId) {
        for (const targetUserId of envelope.targetUserIds) {
          for (const sessionId of this.userIndex.get(targetUserId) ?? []) {
            await this.attachToGuild(sessionId, guildId);
          }
        }
      }
    }
  }

  /** Bir bağlantıyı bir sunucunun olay yayınına bağlar. */
  private async attachToGuild(sessionId: string, guildId: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    connection.guildIds.add(guildId);
    const set = this.guildIndex.get(guildId) ?? new Set();
    set.add(sessionId);
    this.guildIndex.set(guildId, set);
    // İzin önbelleği bu sunucu için henüz boş; yine de temiz başlat.
    connection.invalidatePermissions(guildId);
    await this.subscribeTo(PubSubChannels.guild(guildId));
  }

  private resolveTargets(channel: string, envelope: EventEnvelope): Connection[] {
    if (envelope.targetUserIds?.length) {
      const result: Connection[] = [];
      for (const targetUserId of envelope.targetUserIds) {
        for (const sessionId of this.userIndex.get(targetUserId) ?? []) {
          const connection = this.connections.get(sessionId);
          if (connection) result.push(connection);
        }
      }
      return result;
    }

    if (envelope.guildId) {
      const sessions = this.guildIndex.get(envelope.guildId) ?? new Set();
      return [...sessions].flatMap((sessionId) => {
        const connection = this.connections.get(sessionId);
        return connection ? [connection] : [];
      });
    }

    // Kullanıcı kanalı: `evt:user:<id>`
    const userIdValue = channel.split(':').pop();
    if (!userIdValue) return [];
    return [...(this.userIndex.get(userIdValue) ?? [])].flatMap((sessionId) => {
      const connection = this.connections.get(sessionId);
      return connection ? [connection] : [];
    });
  }

  /** Yeni katılan üyenin açık bağlantıları o sunucunun yayınına eklenir. */
  private async syncMembership(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as { user?: { id?: string } } | undefined;
    const newUserId = payload?.user?.id;
    if (!newUserId || !envelope.guildId) return;

    for (const sessionId of this.userIndex.get(newUserId) ?? []) {
      const connection = this.connections.get(sessionId);
      if (!connection) continue;
      await this.attachToGuild(sessionId, envelope.guildId);

      const ready = await buildReadyGuild(
        BigInt(envelope.guildId),
        BigInt(newUserId),
        this.voiceSnapshotForGuild(envelope.guildId),
      );
      if (ready) connection.dispatch(GatewayEvent.GUILD_CREATE, ready);
    }
  }

  private sweepDeadConnections(): void {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    for (const connection of this.connections.values()) {
      if (connection.lastHeartbeat < cutoff) {
        connection.close(GatewayCloseCode.SESSION_TIMED_OUT, 'Heartbeat gelmedi');
        void this.unregister(connection);
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const connection of this.connections.values()) {
      connection.close(1001, 'Sunucu kapanıyor');
    }
    this.wss.close();
  }
}
