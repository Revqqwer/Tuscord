/**
 * Okunmamış mesaj sayısı — READY'de bir kerelik hesaplanır (bkz.
 * gateway/index.ts register). Sonrasında istemci kendi güncelliyor: her
 * MESSAGE_CREATE'te +1 (aktif kanal değilse), ack'te 0 (bkz. store/index.ts).
 *
 * mentionCount'un aksine (yalnızca @bahsetme'de artan, sunucuda kalıcı bir
 * sayaç — bkz. routes/messages.ts) burada kalıcı bir sayaç YOK: her mesajda
 * TÜM kanal üyeleri için satır güncellemek ölçekte gereksiz yazma yükü
 * olurdu (aynı gerekçe mentionCount'un @everyone'da sayaç artırmamasıyla
 * ortak). Bunun yerine tek seferlik bir COUNT sorgusu yeterli.
 */

import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { messages, readStates } from '../db/schema.js';

/** Verilen kanallar için, kullanıcının o kanalda okumadığı mesaj sayısı. */
export async function computeUnreadCounts(
  userId: bigint,
  channelIds: bigint[],
): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();

  const rows = await db
    .select({
      channelId: messages.channelId,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .leftJoin(
      readStates,
      and(eq(readStates.channelId, messages.channelId), eq(readStates.userId, userId)),
    )
    .where(
      and(
        inArray(messages.channelId, channelIds),
        or(isNull(readStates.lastReadMessageId), gt(messages.id, readStates.lastReadMessageId)),
      ),
    )
    .groupBy(messages.channelId);

  return new Map(rows.map((r) => [r.channelId.toString(), r.count]));
}
