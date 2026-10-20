/**
 * Bir mesaj için push bildirimi kimlere gitmeli?
 *
 * Eskiden kanaldaki herkese her mesajda gidiyordu — kalabalık sunucularda
 * telefonlar sürekli titrerdi (iOS bildirimleri çalışmaya başlayınca çok
 * belirginleşti). Discord'un varsayılanına benzer kural:
 *   - DM / grup DM: her mesaj, tüm alıcılara.
 *   - Sunucu kanalı: yalnızca bahsedilenlere (@kullanıcı), bahsedilen rolün
 *     üyelerine (@rol), yanıtlanan mesajın yazarına ve @everyone ise herkese.
 * Yazarın kendisi her zaman hariç.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memberRoles } from '../db/schema.js';

export interface PushAudienceInput {
  /** null → DM / grup DM. */
  guildId: bigint | null;
  authorId: bigint;
  /** Kanalı görebilen herkes (yazar dahil olabilir). */
  recipients: readonly bigint[];
  mentionUsers: readonly string[];
  mentionRoles: readonly string[];
  mentionEveryone: boolean;
  /** Yanıt verilen mesajın yazarı (varsa). */
  replyAuthorId: bigint | null;
}

export async function pushAudience(input: PushAudienceInput): Promise<string[]> {
  const author = input.authorId.toString();
  const allowed = new Set(input.recipients.map((r) => r.toString()));
  allowed.delete(author);

  // DM: herkese.
  if (input.guildId === null) return [...allowed];
  // @everyone: kanalı görebilen herkese.
  if (input.mentionEveryone) return [...allowed];

  const wanted = new Set<string>(input.mentionUsers);
  if (input.replyAuthorId !== null) wanted.add(input.replyAuthorId.toString());

  if (input.mentionRoles.length > 0) {
    const rows = await db
      .select({ userId: memberRoles.userId })
      .from(memberRoles)
      .where(
        and(
          eq(memberRoles.guildId, input.guildId),
          inArray(memberRoles.roleId, input.mentionRoles.map((r) => BigInt(r))),
        ),
      );
    for (const row of rows) wanted.add(row.userId.toString());
  }

  // Kanalı göremeyene (ve yazarın kendisine) bildirim gitmesin.
  return [...wanted].filter((id) => allowed.has(id));
}
