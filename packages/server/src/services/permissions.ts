/**
 * İzin servisi — veritabanı ile saf izin motoru arasındaki tek köprü.
 *
 * KURAL: Rotalarda `role.permissions & X` gibi elle kontrol YOK.
 * Her yetkilendirme buradaki assert* fonksiyonlarından geçer; bunlar da
 * @tuscord/shared içindeki computePermissions()'ı çağırır.
 *
 * Not: Faz 1'de her kontrol veritabanına gider. Sorgular indekslidir ve bu
 * ölçekte sorun değil. Darboğaz ölçülürse guild bağlamı Redis'te
 * önbelleklenebilir — ama önce ölç.
 */

import { and, eq, inArray } from 'drizzle-orm';
import {
  computeBasePermissions,
  computePermissions,
  canManageMember,
  canManageRole,
  has,
  Permission,
  type ChannelLike,
  type GuildLike,
  type MemberLike,
  type PermissionBits,
  type PermissionOverwriteLike,
  type RoleLike,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { channels, guildMembers, guilds, memberRoles, permissionOverwrites, roles } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import type { Channel } from '../db/schema.js';

export interface GuildContext extends GuildLike {
  /** Ham roller — sıralama ve API cevabı için. */
  allRoles: RoleLike[];
}

/** Sunucunun rol yapısını ve sahibini yükler. */
export async function loadGuildContext(guildId: bigint): Promise<GuildContext | null> {
  const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
  if (!guild) return null;

  const rows = await db.select().from(roles).where(eq(roles.guildId, guildId));

  // @everyone rolünün id'si guild.id ile aynıdır.
  const everyoneRow = rows.find((r) => r.id === guildId);
  if (!everyoneRow) {
    // Şema garantisi bozulmuş; sessizce yanlış izin hesaplamaktansa patla.
    throw new Error(`Sunucu ${guildId} için @everyone rolü yok — veri tutarsız`);
  }

  const everyoneRole: RoleLike = {
    id: everyoneRow.id.toString(),
    position: everyoneRow.position,
    permissions: everyoneRow.permissions,
  };

  const others = rows
    .filter((r) => r.id !== guildId)
    .map<RoleLike>((r) => ({
      id: r.id.toString(),
      position: r.position,
      permissions: r.permissions,
    }));

  return {
    id: guildId.toString(),
    ownerId: guild.ownerId.toString(),
    everyoneRole,
    roles: new Map(others.map((r) => [r.id, r])),
    allRoles: [everyoneRole, ...others],
  };
}

/** Üyelik kaydı + rolleri. Üye değilse null. */
export async function loadMember(guildId: bigint, userId: bigint): Promise<MemberLike | null> {
  const membership = await db.query.guildMembers.findFirst({
    where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)),
  });
  if (!membership) return null;

  const roleRows = await db
    .select({ roleId: memberRoles.roleId })
    .from(memberRoles)
    .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, userId)));

  return {
    userId: userId.toString(),
    roleIds: roleRows.map((r) => r.roleId.toString()),
    timeoutUntil: membership.timeoutUntil,
  };
}

export async function loadChannelOverwrites(channelId: bigint): Promise<ChannelLike> {
  const rows = await db
    .select()
    .from(permissionOverwrites)
    .where(eq(permissionOverwrites.channelId, channelId));

  return {
    id: channelId.toString(),
    overwrites: rows.map<PermissionOverwriteLike>((r) => ({
      targetId: r.targetId.toString(),
      targetType: r.targetType as 'role' | 'member',
      allow: r.allow,
      deny: r.deny,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Yetkilendirme yardımcıları                                          */
/* ------------------------------------------------------------------ */

export interface GuildAccess {
  guild: GuildContext;
  member: MemberLike;
  /** Kanal overwrite'ları hariç sunucu düzeyi izinler. */
  permissions: PermissionBits;
}

/**
 * Kullanıcının sunucudaki bağlamını yükler ve izinlerini hesaplar.
 * Sunucu yoksa VEYA kullanıcı üye değilse 404 — üye olmadığın bir sunucunun
 * varlığını öğrenmemelisin.
 */
export async function requireGuildAccess(guildId: bigint, userId: bigint): Promise<GuildAccess> {
  const guild = await loadGuildContext(guildId);
  if (!guild) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');

  const member = await loadMember(guildId, userId);
  if (!member) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');

  return { guild, member, permissions: computeBasePermissions(guild, member) };
}

export interface ChannelAccess extends GuildAccess {
  channel: Channel;
  /** Kanal overwrite'ları uygulanmış nihai izinler. */
  permissions: PermissionBits;
}

/**
 * Kanal bağlamını yükler ve nihai izinleri hesaplar.
 * VIEW_CHANNEL yoksa 404 döner — gizli kanalın varlığı sızmasın (spec Bölüm 6).
 */
export async function requireChannelAccess(
  channelId: bigint,
  userId: bigint,
): Promise<ChannelAccess> {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel || channel.guildId === null) {
    throw Errors.notFound('unknown_channel', 'Kanal bulunamadı');
  }

  const access = await requireGuildAccess(channel.guildId, userId);
  const overwrites = await loadChannelOverwrites(channelId);
  const permissions = computePermissions(access.guild, access.member, overwrites);

  if (!has(permissions, Permission.VIEW_CHANNEL)) {
    throw Errors.notFound('unknown_channel', 'Kanal bulunamadı');
  }

  return { ...access, channel, permissions };
}

/** İzin yoksa 403. */
export function assertPermission(permissions: PermissionBits, required: PermissionBits): void {
  if (!has(permissions, required)) throw Errors.forbidden();
}

/** Rol hiyerarşisi kontrolü — ban/kick/rol verme öncesi zorunlu. */
export async function assertCanManageMember(
  guild: GuildContext,
  actor: MemberLike,
  targetUserId: bigint,
): Promise<MemberLike> {
  const target = await loadMember(BigInt(guild.id), targetUserId);
  if (!target) throw Errors.notFound('unknown_member', 'Üye bulunamadı');
  if (!canManageMember(guild, actor, target)) {
    throw Errors.forbidden('role_hierarchy', 'Bu üye senden yüksek veya eşit konumda');
  }
  return target;
}

export function assertCanManageRole(
  guild: GuildContext,
  actor: MemberLike,
  role: RoleLike,
): void {
  if (!canManageRole(guild, actor, role)) {
    throw Errors.forbidden('role_hierarchy', 'Bu rol senin en yüksek rolünden yüksek veya eşit');
  }
}

/**
 * Kanal kilidi: moderatörün tek tıkla kapattığı kanal.
 * MANAGE_CHANNELS izni olanlar kilitli kanala yazmaya devam edebilir.
 */
export function assertChannelWritable(channel: Channel, permissions: PermissionBits): void {
  if (channel.locked && !has(permissions, Permission.MANAGE_CHANNELS)) {
    throw Errors.forbidden('channel_locked', 'Kanal kilitli');
  }
}

/**
 * Kullanıcının sunucu içinde göreceği kanalları süzer.
 * READY ve kanal listesi uçları bunu kullanır — görünmeyen kanallar
 * istemciye hiç gitmez.
 */
export async function visibleChannels(
  guild: GuildContext,
  member: MemberLike,
  guildId: bigint,
): Promise<Array<{ channel: Channel; permissions: PermissionBits; overwrites: PermissionOverwriteLike[] }>> {
  const channelRows = await db.select().from(channels).where(eq(channels.guildId, guildId));
  if (channelRows.length === 0) return [];

  const overwriteRows = await db
    .select()
    .from(permissionOverwrites)
    .where(
      inArray(
        permissionOverwrites.channelId,
        channelRows.map((c) => c.id),
      ),
    );

  const byChannel = new Map<string, PermissionOverwriteLike[]>();
  for (const row of overwriteRows) {
    const key = row.channelId.toString();
    const list = byChannel.get(key) ?? [];
    list.push({
      targetId: row.targetId.toString(),
      targetType: row.targetType as 'role' | 'member',
      allow: row.allow,
      deny: row.deny,
    });
    byChannel.set(key, list);
  }

  const result = [];
  for (const channel of channelRows) {
    const overwrites = byChannel.get(channel.id.toString()) ?? [];
    const permissions = computePermissions(guild, member, {
      id: channel.id.toString(),
      overwrites,
    });
    if (has(permissions, Permission.VIEW_CHANNEL)) {
      result.push({ channel, permissions, overwrites });
    }
  }
  return result;
}
