/**
 * FCM (Firebase Cloud Messaging) HTTP v1 — Android push.
 *
 * Capacitor'ün `@capacitor/push-notifications` eklentisi Android'de Expo değil
 * ham FCM kayıt token'ı verir; bu yüzden APNs gibi doğrudan gönderiyoruz.
 * Üçüncü taraf paket yok: servis hesabı JSON'undan RS256 JWT üretip OAuth2
 * erişim token'ına çeviriyoruz (Google'ın "service account" akışı).
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from '../env.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let account: ServiceAccount | null = null;
let accessToken: { value: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadAccount(): ServiceAccount | null {
  if (account) return account;
  if (!env.FCM_SERVICE_ACCOUNT_PATH) return null;
  account = JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT_PATH, 'utf8')) as ServiceAccount;
  return account;
}

export function fcmConfigured(): boolean {
  return Boolean(env.FCM_SERVICE_ACCOUNT_PATH);
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (accessToken && accessToken.expiresAt - now > 60_000) return accessToken.value;

  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const assertion = `${header}.${claims}.${base64url(signer.sign(sa.private_key))}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM OAuth hatası ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return json.access_token;
}

interface FcmResult {
  ok: boolean;
  status?: number;
  /** Token artık geçerli değil (uygulama silinmiş vb.) — çağıran silebilir. */
  tokenInvalid?: boolean;
}

export async function sendFcmPush(
  deviceToken: string,
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<FcmResult> {
  try {
    const sa = loadAccount();
    if (!sa) return { ok: false };
    const bearer = await getAccessToken(sa);

    // FCM `data` değerleri yalnızca string olabilir.
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(notification.data ?? {})) {
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }

    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: notification.title, body: notification.body },
          data,
          android: { priority: 'HIGH' },
        },
      }),
    });
    if (res.ok) return { ok: true, status: res.status };

    const text = await res.text();
    // 404 UNREGISTERED: cihaz token'ı ölü. (400 INVALID_ARGUMENT token biçimi bozuksa da gelir.)
    const tokenInvalid = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text);
    if (!tokenInvalid) console.error('[push] FCM hata döndürdü', res.status, text);
    return { ok: false, status: res.status, tokenInvalid };
  } catch (error) {
    console.error('[push] FCM gönderimi başarısız', error);
    return { ok: false };
  }
}
