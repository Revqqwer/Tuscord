/**
 * Bir kullanıcının bir sunucudaki tam görünür durumu.
 *
 * İki yerden kullanılıyor: gateway READY paketi ve GUILD_CREATE olayı
 * (sunucu oluşturulduğunda / davetle katılındığında). Aynı şekli iki yerde
 * kurmak, birini güncelleyip diğerini unutmak demekti.
 */

import { and, eq } from 'drizzle-orm';
import { computeBasePermissions, type ReadyGuild, type VoiceStateUpdatePayload } from '@tuscord/shared';
import { db } from '../db/index.js';
import { guildMembers, guilds, roles, users } from '../db/schema.js';
import { loadGuildContext, loadMember, visibleChannels } from './permissions.js';
import { toAPIChannel, toAPIGuild, toAPIMember, toAPIRole } from './serialize.js';

export async function buildReadyGuild(
  guildId: bigint,
  userId: bigint,
  /**
   * Bu sunucudaki TÜM ses kanalı doluluğu (kanal görünürlüğüne bakılmaksızın)
   * — gateway'in bellekteki `voiceStates`'inden gelir. Burada, aşağıda
   * hesaplanan `visible` kanal kümesine göre süzülür; çağıran taraf
   * (Gateway) görünürlük kontrolü yapmaz, bilerek burada yapılır.
   */
  voiceSnapshot: VoiceStateUpdatePayload[] = [],
): Promise<ReadyGuild | null> {
  const guildRow = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
  if (!guildRow) return null;

  const context = await loadGuildContext(guildId);
  const member = await loadMember(guildId, userId);
  if (!context || !member) return null;

  const [visible, membership, user, roleRows, memberRows] = await Promise.all([
    visibleChannels(context, member, guildId),
    db.query.guildMembers.findFirst({
      where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)),
    }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.select().from(roles).where(eq(roles.guildId, guildId)),
    db.select({ userId: guildMembers.userId }).from(guildMembers).where(eq(guildMembers.guildId, guildId)),
  ]);

  if (!membership || !user) return null;

  const visibleChannelIds = new Set(visible.map((v) => v.channel.id.toString()));
  // channelId burada hep dolu (gateway'in bellekteki voiceStates'i yalnızca
  // aktif katılımları tutar) — tip yalnızca VoiceStateUpdatePayload'ın genel
  // "ayrıldı" (null) şeklini paylaştığı için `| null`.
  const voiceStates = voiceSnapshot.filter(
    (s): s is typeof s & { channelId: string } => s.channelId !== null && visibleChannelIds.has(s.channelId),
  );

  return {
    guild: toAPIGuild(guildRow),
    channels: visible.map((v) => toAPIChannel(v.channel, { includeOverwrites: v.overwrites })),
    roles: roleRows.map(toAPIRole),
    member: toAPIMember(
      membership,
      user,
      member.roleIds.map((id) => BigInt(id)),
    ),
    memberCount: memberRows.length,
    permissions: computeBasePermissions(context, member).toString(),
    voiceStates,
  };
}
