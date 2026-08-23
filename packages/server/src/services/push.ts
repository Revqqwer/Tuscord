/**
 * Mobil push bildirimleri — Expo'nun push servisi üzerinden.
 *
 * Expo'nun kendi kimlik doğrulaması yok: `token`'ın kendisi (ExponentPushToken[...])
 * zaten tek başına yeterli kimlik — istemci bunu expo-notifications ile alıp
 * `POST /users/@me/push-tokens`'a kaydediyor (bkz. routes/users.ts).
 *
 * 100 mesajlık gruplar halinde gönderiyoruz — Expo'nun API sınırı bu (bkz.
 * https://docs.expo.dev/push-notifications/sending-notifications/#push-tickets-request).
 * Tek bir bildirim başarısız olursa diğerlerini engellemesin diye hepsini
 * tek istekte gönderip sonucu sadece logluyoruz; kalıcı geçersiz token'ları
 * (DeviceNotRegistered) temizlemek Faz 2.1 kapsamı — şimdilik loglamak yeterli.
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pushTokens } from '../db/schema.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * `userIds` içindeki (mesajın yazarı hariç, çağıran taraf zaten filtreliyor)
 * kullanıcıların kayıtlı TÜM cihazlarına aynı bildirimi gönderir.
 */
export async function sendPushToUsers(
  userIds: string[],
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (userIds.length === 0) return;

  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, userIds.map(BigInt)));
  if (rows.length === 0) return;

  const messages: PushMessage[] = rows.map((r) => ({
    to: r.token,
    title: notification.title,
    body: notification.body,
    data: notification.data,
  }));

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error('[push] Expo push API hata döndürdü', res.status, await res.text());
      }
    } catch (error) {
      console.error('[push] gönderim başarısız', error);
    }
  }
}

/** Cihaz çıkış yaptığında veya token geçersizleştiğinde temizlik için. */
export async function removePushToken(token: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.token, token));
}
