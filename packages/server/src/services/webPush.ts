/**
 * Tarayıcı Web Push bildirimleri (VAPID) — Expo push'un (services/push.ts)
 * aksine bir mobil uygulama gerektirmez, web/PWA'da çalışır ve sekme/PWA
 * TAMAMEN KAPALIYKEN de bildirim gösterebilir (işletim sistemi push
 * servisi — Chrome için FCM, Firefox için Mozilla vb. — üzerinden).
 *
 * VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ayarlı değilse özellik sessizce
 * devre dışı kalır (subscribe uçları 503 döner, gönderim no-op'tur) —
 * geliştirme ortamında zorunlu bir bağımlılık olmasın diye.
 */
import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { webPushSubscriptions } from '../db/schema.js';
import { env } from '../env.js';

export const webPushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (webPushEnabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

interface WebPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * `userIds` içindeki (çağıran taraf mesaj yazarını zaten filtreliyor)
 * kullanıcıların kayıtlı TÜM tarayıcı aboneliklerine aynı bildirimi
 * gönderir. Süresi dolmuş/iptal edilmiş abonelikleri (404/410) sessizce
 * siler — kullanıcı bildirimi kapatmış ya da veri temizlemiş olabilir,
 * hata sayılmaz.
 */
export async function sendWebPushToUsers(userIds: string[], notification: WebPushPayload): Promise<void> {
  if (!webPushEnabled || userIds.length === 0) return;

  const rows = await db
    .select()
    .from(webPushSubscriptions)
    .where(inArray(webPushSubscriptions.userId, userIds.map(BigInt)));
  if (rows.length === 0) return;

  const payload = JSON.stringify(notification);
  const expiredEndpoints: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(row.endpoint);
        } else {
          console.error('[webPush] gönderim başarısız', error);
        }
      }
    }),
  );

  if (expiredEndpoints.length > 0) {
    await db.delete(webPushSubscriptions).where(inArray(webPushSubscriptions.endpoint, expiredEndpoints));
  }
}

export async function removeWebPushSubscription(endpoint: string): Promise<void> {
  await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint));
}
