/**
 * Kanal erişimi — sunucu kanalı ve DM'i tek bir arayüz altında toplar.
 *
 * DM'lerde rol/overwrite yoktur: katılımcıysan sabit bir izin kümesine sahipsin.
 * MANAGE_MESSAGES verilmez — DM'de kimse karşısındakinin mesajını silemez
 * (kendi mesajını silmek ayrı bir kural, yazarlık kontrolüyle yapılır).
 */

import { and, eq } from 'drizzle-orm';
import {
  ChannelType,
  Permission,
  has,
  type PermissionBits,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { channelRecipients, channels } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { requireChannelAccess, type ChannelAccess } from './permissions.js';
import type { Channel } from '../db/schema.js';

const DM_PERMISSIONS: PermissionBits =
  Permission.VIEW_CHANNEL |
  Permission.READ_MESSAGE_HISTORY |
  Permission.SEND_MESSAGES |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO;

export interface MessageChannelAccess {
  channel: Channel;
  permissions: PermissionBits;
  guildId: bigint | null;
  /** DM/grup DM ise katılımcı kullanıcı kimlikleri; sunucu kanalıysa boş. */
  recipients: bigint[];
  /** Sunucu kanalıysa tam erişim bağlamı (rol hiyerarşisi kontrolleri için). */
  guildAccess: ChannelAccess | null;
}

export async function requireMessageChannel(
  channelId: bigint,
  userId: bigint,
): Promise<MessageChannelAccess> {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw Errors.notFound('unknown_channel', 'Kanal bulunamadı');

  if (channel.guildId !== null) {
    const access = await requireChannelAccess(channelId, userId);
    return {
      channel: access.channel,
      permissions: access.permissions,
      guildId: channel.guildId,
      recipients: [],
      guildAccess: access,
    };
  }

  if (channel.type !== ChannelType.DM && channel.type !== ChannelType.GROUP_DM) {
    throw Errors.notFound('unknown_channel', 'Kanal bulunamadı');
  }

  const membership = await db.query.channelRecipients.findFirst({
    where: and(
      eq(channelRecipients.channelId, channelId),
      eq(channelRecipients.userId, userId),
    ),
  });
  if (!membership) throw Errors.notFound('unknown_channel', 'Kanal bulunamadı');

  const all = await db
    .select({ userId: channelRecipients.userId })
    .from(channelRecipients)
    .where(eq(channelRecipients.channelId, channelId));

  return {
    channel,
    permissions: DM_PERMISSIONS,
    guildId: null,
    recipients: all.map((r) => r.userId),
    guildAccess: null,
  };
}

/** Kanalda yazma izni + kilit kontrolü tek yerde. */
export function assertCanSend(access: MessageChannelAccess): void {
  if (!has(access.permissions, Permission.SEND_MESSAGES)) {
    throw Errors.forbidden();
  }
  if (access.channel.locked && !has(access.permissions, Permission.MANAGE_CHANNELS)) {
    throw Errors.forbidden('channel_locked', 'Kanal kilitli');
  }
  if (
    access.channel.type !== ChannelType.GUILD_TEXT &&
    access.channel.type !== ChannelType.DM &&
    access.channel.type !== ChannelType.GROUP_DM
  ) {
    throw Errors.badRequest('invalid_channel_type', 'Bu kanala mesaj gönderilemez');
  }
}
