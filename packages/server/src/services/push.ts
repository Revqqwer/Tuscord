/**
 * Mobil push bildirimleri — platforma göre iki ayrı taşıyıcı:
 *  - iOS: doğrudan APNs (bkz. services/apns.ts) — `@capacitor/push-notifications`
 *    ham APNs cihaz token'ı veriyor, Expo formatında değil.
 *  - Android (Capacitor kabuğu): doğrudan FCM HTTP v1 (bkz. services/fcm.ts).
 *    Eski/Expo biçimli kayıtlar (ExponentPushToken[...]) Expo servisinden gider.
 *
 * `token`'ın kendisi tek başına yeterli kimlik; istemci bunu alıp
 * `POST /users/@me/push-tokens`'a kaydediyor (bkz. routes/users.ts).
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { pushTokens } from '../db/schema.js';
import { sendApnsPush } from './apns.js';
import { fcmConfigured, sendFcmPush } from './fcm.js';

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

async function sendToAndroid(
  tokens: string[],
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (tokens.length === 0) return;
  const messages: PushMessage[] = tokens.map((token) => ({ to: token, ...notification }));

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
      console.error('[push] Expo gönderimi başarısız', error);
    }
  }
}

/** Capacitor Android uygulaması ham FCM token'ı kaydeder; Expo formatı eski kayıtlar içindir. */
async function sendToFcm(
  tokens: string[],
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (tokens.length === 0 || !fcmConfigured()) return;

  const invalid: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      const result = await sendFcmPush(token, notification);
      if (result.tokenInvalid) invalid.push(token);
    }),
  );

  if (invalid.length > 0) {
    await db.delete(pushTokens).where(inArray(pushTokens.token, invalid));
  }
}

async function sendToIos(
  tokens: string[],
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (tokens.length === 0) return;

  const invalid: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      const result = await sendApnsPush(token, notification);
      if (result.tokenInvalid) invalid.push(token);
    }),
  );

  if (invalid.length > 0) {
    await db.delete(pushTokens).where(inArray(pushTokens.token, invalid));
  }
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
    .select({ token: pushTokens.token, platform: pushTokens.platform })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, userIds.map(BigInt)));
  if (rows.length === 0) return;

  const iosTokens = rows.filter((r) => r.platform === 'ios').map((r) => r.token);
  const androidTokens = rows.filter((r) => r.platform === 'android').map((r) => r.token);
  const expoTokens = androidTokens.filter((t) => t.startsWith('ExponentPushToken'));
  const fcmTokens = androidTokens.filter((t) => !t.startsWith('ExponentPushToken'));

  await Promise.all([
    sendToIos(iosTokens, notification),
    sendToAndroid(expoTokens, notification),
    sendToFcm(fcmTokens, notification),
  ]);
}

/** Cihaz çıkış yaptığında veya token geçersizleştiğinde temizlik için. */
export async function removePushToken(token: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.token, token));
}
