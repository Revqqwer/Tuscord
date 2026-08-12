/**
 * Tek bir WebSocket bağlantısı.
 *
 * İzin önbelleği bağlantı başına tutulur: bir olay yayınlandığında
 * "bu kullanıcı bu kanalı görebiliyor mu" sorusu her seferinde veritabanına
 * gitmemeli. Rol/kanal/üyelik değişince önbellek temizlenir — bayat izinle
 * gizli kanal sızdırmak, biraz fazla sorgudan çok daha pahalıdır.
 */

import type { WebSocket } from 'ws';
import {
  GatewayOp,
  Permission,
  RESUME_BUFFER_SIZE,
  computePermissions,
  has,
  type GatewayEvent,
  type GatewayPacket,
  type PermissionBits,
} from '@tuscord/shared';
import { loadChannelOverwrites, loadGuildContext, loadMember, type GuildContext } from '../services/permissions.js';
import type { MemberLike } from '@tuscord/shared';

export interface BufferedEvent {
  seq: number;
  packet: GatewayPacket;
}

export class Connection {
  readonly userId: string;
  readonly sessionId: string;
  readonly socket: WebSocket;

  /** Kullanıcının üye olduğu sunucular — abonelik yönetimi için. */
  guildIds = new Set<string>();

  /** Son gönderilen sıra numarası. RESUME buradan devam eder. */
  seq = 0;

  /** RESUME için son N olay. Bellekte tutulur: kopma penceresi 2 dakika. */
  private buffer: BufferedEvent[] = [];

  /** Son HEARTBEAT zamanı — zombi bağlantı tespiti. */
  lastHeartbeat = Date.now();

  /** guildId → sunucu bağlamı (roller, sahip). */
  private guildCache = new Map<string, { guild: GuildContext; member: MemberLike }>();
  /** channelId → hesaplanmış izinler. */
  private channelCache = new Map<string, PermissionBits>();

  closed = false;

  constructor(socket: WebSocket, userId: string, sessionId: string) {
    this.socket = socket;
    this.userId = userId;
    this.sessionId = sessionId;
  }

  send(packet: GatewayPacket): void {
    if (this.closed || this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify(packet));
  }

  /** DISPATCH gönderir ve RESUME tamponuna yazar. */
  dispatch(event: GatewayEvent, payload: unknown): void {
    this.seq += 1;
    const packet: GatewayPacket = { op: GatewayOp.DISPATCH, t: event, s: this.seq, d: payload };
    this.buffer.push({ seq: this.seq, packet });
    if (this.buffer.length > RESUME_BUFFER_SIZE) this.buffer.shift();
    this.send(packet);
  }

  /** RESUME sonrası kaçırılan olayları tekrar gönderir. */
  replayFrom(lastSeq: number): boolean {
    const oldest = this.buffer[0];
    // İstenen nokta tampondan düştüyse sürdürülemez — istemci yeniden IDENTIFY etmeli.
    if (oldest && lastSeq < oldest.seq - 1) return false;
    for (const entry of this.buffer) {
      if (entry.seq > lastSeq) this.send(entry.packet);
    }
    return true;
  }

  /**
   * Bu bağlantının bir kanaldaki izinleri.
   * DM kanalları gateway tarafından süzülmez — yayın zaten yalnızca
   * katılımcılara yapılır.
   */
  async permissionsIn(guildId: string, channelId: string): Promise<PermissionBits> {
    const cached = this.channelCache.get(channelId);
    if (cached !== undefined) return cached;

    const context = await this.guildContext(guildId);
    if (!context) return 0n;

    const overwrites = await loadChannelOverwrites(BigInt(channelId));
    const permissions = computePermissions(context.guild, context.member, overwrites);
    this.channelCache.set(channelId, permissions);
    return permissions;
  }

  async canView(guildId: string, channelId: string, required?: PermissionBits): Promise<boolean> {
    const permissions = await this.permissionsIn(guildId, channelId);
    if (!has(permissions, Permission.VIEW_CHANNEL)) return false;
    if (required && !has(permissions, required)) return false;
    return true;
  }

  private async guildContext(guildId: string) {
    const cached = this.guildCache.get(guildId);
    if (cached) return cached;

    const guild = await loadGuildContext(BigInt(guildId));
    if (!guild) return null;
    const member = await loadMember(BigInt(guildId), BigInt(this.userId));
    if (!member) return null;

    const entry = { guild, member };
    this.guildCache.set(guildId, entry);
    return entry;
  }

  /** Rol, kanal veya üyelik değiştiğinde çağrılır. */
  invalidatePermissions(guildId?: string): void {
    if (guildId) {
      this.guildCache.delete(guildId);
      // Hangi kanalın hangi sunucuya ait olduğunu burada bilmiyoruz;
      // sunucu bazlı geçersiz kılmada kanal önbelleğini tamamen temizlemek
      // en güvenli davranış (önbellek zaten küçük).
      this.channelCache.clear();
      return;
    }
    this.guildCache.clear();
    this.channelCache.clear();
  }

  close(code: number, reason: string): void {
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch {
      // Soket zaten kapanmış olabilir.
    }
  }
}
