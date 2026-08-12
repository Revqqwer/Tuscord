/**
 * DM ve grup DM kanallarının yüklenmesi.
 *
 * Hem gateway READY paketi hem REST ucu aynı şekli döndürmeli: kanal,
 * kendisi hariç katılımcılarıyla birlikte. İki yerde ayrı kurmak, birini
 * güncelleyip diğerini unutmak demekti.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { APIChannel } from '@tuscord/shared';
import { db } from '../db/index.js';
import { channelRecipients, channels, users } from '../db/schema.js';
import { toAPIChannel, toPublicUser } from './serialize.js';

export async function loadPrivateChannels(userId: bigint): Promise<APIChannel[]> {
  const memberships = await db
    .select({ channelId: channelRecipients.channelId })
    .from(channelRecipients)
    .where(and(eq(channelRecipients.userId, userId), eq(channelRecipients.closed, false)));

  if (memberships.length === 0) return [];
  const channelIds = memberships.map((row) => row.channelId);

  const [channelRows, recipientRows] = await Promise.all([
    db.select().from(channels).where(inArray(channels.id, channelIds)),
    db
      .select()
      .from(channelRecipients)
      .innerJoin(users, eq(users.id, channelRecipients.userId))
      .where(inArray(channelRecipients.channelId, channelIds)),
  ]);

  const byChannel = new Map<string, ReturnType<typeof toPublicUser>[]>();
  for (const row of recipientRows) {
    // Kendini alıcı listesinde gösterme — istemci karşı tarafı arıyor.
    if (row.users.id === userId) continue;
    const key = row.channel_recipients.channelId.toString();
    byChannel.set(key, [...(byChannel.get(key) ?? []), toPublicUser(row.users)]);
  }

  return channelRows.map((channel) =>
    toAPIChannel(channel, { recipients: byChannel.get(channel.id.toString()) ?? [] }),
  );
}
