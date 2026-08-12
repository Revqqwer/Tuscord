/**
 * Bir kullanıcıyı sunucuya ekler — davet ve isimle katılma ortak kullanır.
 *
 * Ban, mevcut üyelik, raid koruması (hesap yaşı + e-posta) kontrolleri; sonra
 * üyelik kaydı, mevcut üyelere GUILD_MEMBER_ADD, katılana GUILD_CREATE.
 */

import { and, eq } from 'drizzle-orm';
import { GatewayEvent } from '@tuscord/shared';
import { db } from '../db/index.js';
import { bans, guildMembers, guilds, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { publishToGuild, publishToUsers } from './events.js';
import { toAPIMember } from './serialize.js';
import { buildReadyGuild } from './readyGuild.js';
import type { Guild } from '../db/schema.js';

/**
 * @returns katılınan sunucu; zaten üyeyse yine sunucu döner (hata değil).
 * @throws  ban / raid koruması ihlallerinde APIException.
 */
export async function joinGuild(guild: Guild, userIdValue: bigint): Promise<Guild> {
  const banned = await db.query.bans.findFirst({
    where: and(eq(bans.guildId, guild.id), eq(bans.userId, userIdValue)),
  });
  if (banned) throw Errors.forbidden('banned', 'Bu sunucudan yasaklandın');

  const existing = await db.query.guildMembers.findFirst({
    where: and(eq(guildMembers.guildId, guild.id), eq(guildMembers.userId, userIdValue)),
  });
  if (existing) return guild;

  const user = await db.query.users.findFirst({ where: eq(users.id, userIdValue) });
  if (!user) throw Errors.unauthorized();

  // Raid koruması (spec Bölüm 8).
  if (guild.requireVerifiedEmail && !user.emailVerified) {
    throw Errors.forbidden('email_not_verified', 'Bu sunucu doğrulanmış e-posta istiyor');
  }
  if (guild.minAccountAgeHours > 0) {
    const ageHours = (Date.now() - user.createdAt.getTime()) / 3_600_000;
    if (ageHours < guild.minAccountAgeHours) {
      throw Errors.forbidden('account_too_new', 'Hesabın bu sunucuya katılmak için çok yeni');
    }
  }

  await db.insert(guildMembers).values({ guildId: guild.id, userId: userIdValue });

  const membership = await db.query.guildMembers.findFirst({
    where: and(eq(guildMembers.guildId, guild.id), eq(guildMembers.userId, userIdValue)),
  });

  // Mevcut üyelere yeni katılanı bildir.
  await publishToGuild({
    guildId: guild.id.toString(),
    event: GatewayEvent.GUILD_MEMBER_ADD,
    payload: toAPIMember(membership!, user, []),
  });

  // Katılana sunucunun kendisini doğrudan gönder (bkz. invites.ts açıklaması).
  const ready = await buildReadyGuild(guild.id, userIdValue);
  if (ready) {
    await publishToUsers([userIdValue.toString()], {
      event: GatewayEvent.GUILD_CREATE,
      payload: ready,
    });
  }

  return guild;
}

/** Sunucuyu id ile bulup katılır (yoksa 404). */
export async function joinGuildById(guildId: bigint, userIdValue: bigint): Promise<Guild> {
  const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
  if (!guild) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');
  return joinGuild(guild, userIdValue);
}
