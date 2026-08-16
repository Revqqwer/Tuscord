/**
 * Rol izni, rol ataması ya da kanal overwrite'ı değişince kanal görünürlüğü
 * de değişmiş olabilir — ama bunun için CHANNEL_CREATE/CHANNEL_UPDATE gibi
 * kanal-özel bir olay YOKTUR (bkz. çağıran taraflardaki yorumlar). Bu yüzden
 * etkilenen kullanıcılara TAM bir READY yenilemesi (GUILD_CREATE) gönderilir:
 * `channels` dizisi baştan hesaplanmış hâliyle gelir, hem yeni görünür olan
 * hem artık görünmeyen kanalları doğru şekilde yansıtır.
 *
 * `syncMembership` (yeni üye/sunucu katılımı, gateway/index.ts) ile AYNI
 * istemci yolu — GUILD_CREATE zaten "varsa güncelle" davranışında (bkz.
 * store.ts upsertGuild), bu yüzden sayfa yenilemeye gerek kalmaz.
 */

import { GatewayEvent } from '@tuscord/shared';
import { publishToUsers } from './events.js';
import { buildReadyGuild } from './readyGuild.js';

export async function refreshChannelVisibility(
  guildId: bigint,
  memberIds: readonly bigint[],
): Promise<void> {
  await Promise.all(
    memberIds.map(async (memberId) => {
      const ready = await buildReadyGuild(guildId, memberId);
      if (!ready) return; // üye artık sunucuda değil vb. — sessizce geç
      await publishToUsers([memberId.toString()], {
        guildId: guildId.toString(),
        event: GatewayEvent.GUILD_CREATE,
        payload: ready,
      });
    }),
  );
}
