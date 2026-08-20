/**
 * Bir sunucu silinmeden ÖNCE, o sunucudaki eklerin gerçek dosyalarını
 * depolamadan (yerel disk ya da R2) siler.
 *
 * `guilds` satırı silinince channels/messages/attachments veritabanı
 * kayıtları CASCADE ile otomatik gider (bkz. db/schema.ts), ama bu yalnızca
 * METADATA'yı temizler — nesne deposundaki asıl dosya kalır (bkz. kullanıcı
 * sorusu: "sunuculara ne oluyor" → yanıt: dosyalar öksüz kalıyordu).
 * Bu yüzden asıl dosyalar guild satırı silinmeden ÖNCE, attachments
 * tablosundaki objectKey'ler hâlâ okunabilirken silinmeli.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { attachments, messages } from '../db/schema.js';
import { storage } from './storage.js';

export async function deleteGuildAttachmentFiles(guildId: bigint): Promise<void> {
  const rows = await db
    .select({ objectKey: attachments.objectKey })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(eq(messages.guildId, guildId));

  await Promise.all(
    rows.map((row) =>
      storage.delete(row.objectKey).catch((error) => {
        // Bir dosya silinemese bile sunucu silme işlemi durmaz — en kötü
        // ihtimalle o dosya öksüz kalır, tüm silme işlemini bloke etmez.
        console.error('[guildCleanup] ek dosyası silinemedi', { objectKey: row.objectKey, error });
      }),
    ),
  );
}
