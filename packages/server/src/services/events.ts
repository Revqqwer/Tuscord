/**
 * Olay yayını — REST katmanı ile gateway arasındaki tek bağlantı.
 *
 * REST bir şey değiştirdiğinde buradan yayınlar; gateway düğümleri Redis
 * pub/sub üzerinden alır ve kendi bağlı istemcilerine dağıtır.
 *
 * Kritik: Yayın "sunucuya" yapılır, "kullanıcıya" değil. Kimin göreceğine
 * gateway karar verir çünkü izin durumu bağlantı bazında önbelleklenir.
 * Zarfta `channelId` ve `requiredPermission` varsa gateway süzer.
 */

import type { GatewayEvent } from '@tuscord/shared';
import { publisher, PubSubChannels } from '../redis.js';

export interface EventEnvelope {
  event: GatewayEvent;
  payload: unknown;
  /** Olay bir sunucuya aitse. */
  guildId?: string;
  /** Verilirse alıcının bu kanalda VIEW_CHANNEL izni olmalı. */
  channelId?: string;
  /** VIEW_CHANNEL üstüne aranan ek izin, string bitfield. */
  requiredPermission?: string;
  /** Yalnızca bu kullanıcılara (DM, kişiye özel olaylar). */
  targetUserIds?: string[];
}

export async function publishToGuild(envelope: EventEnvelope & { guildId: string }): Promise<void> {
  await publisher.publish(PubSubChannels.guild(envelope.guildId), JSON.stringify(envelope));
}

export async function publishToUsers(
  userIds: readonly string[],
  envelope: EventEnvelope,
): Promise<void> {
  await Promise.all(
    userIds.map((userId) =>
      publisher.publish(PubSubChannels.user(userId), JSON.stringify({ ...envelope, targetUserIds: [userId] })),
    ),
  );
}

/**
 * Kanal olayları için kısayol: sunucu kanalıysa sunucuya, DM ise alıcılara yayınlar.
 */
export async function publishChannelEvent(
  envelope: EventEnvelope,
  dmRecipients?: readonly string[],
): Promise<void> {
  if (envelope.guildId) {
    await publishToGuild({ ...envelope, guildId: envelope.guildId });
    return;
  }
  if (dmRecipients?.length) {
    await publishToUsers(dmRecipients, envelope);
  }
}
