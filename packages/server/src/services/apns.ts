/**
 * APNs (Apple Push Notification service) — doğrudan HTTP/2 + JWT (ES256).
 *
 * Üçüncü taraf paket gerekmiyor: Node'un `http2` ve `crypto` modülleri
 * Apple'ın "provider token" akışı için yeterli. Bağlantı Apple'ın önerdiği
 * gibi kalıcı tutulur — her bildirim için yeni HTTP/2 bağlantısı açmak
 * Apple'ın belgelerinde açıkça caydırılıyor.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type ClientHttp2Session } from 'node:http2';
import { env } from '../env.js';

const TOKEN_TTL_MS = 55 * 60 * 1000; // Apple azami 60dk kabul ediyor, güvenli pay bırak.

let cachedToken: { jwt: string; issuedAt: number } | null = null;
let session: ClientHttp2Session | null = null;
let cachedKeyPem: string | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Dosya yolu varsa oradan (tercih edilen), yoksa .env'deki düz metinden. */
function loadKeyPem(): string {
  if (cachedKeyPem) return cachedKeyPem;
  cachedKeyPem = env.APNS_KEY_P8_PATH
    ? readFileSync(env.APNS_KEY_P8_PATH, 'utf8')
    : (env.APNS_KEY_P8 ?? '').replace(/\\n/g, '\n');
  return cachedKeyPem;
}

function providerToken(): string {
  const now = Date.now();
  if (cachedToken && now - cachedToken.issuedAt < TOKEN_TTL_MS) return cachedToken.jwt;

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }));
  const payload = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(now / 1000) }));
  const signingInput = `${header}.${payload}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  // Apple JWT ES256 için "raw" (IEEE P1363) imza bekler — Node'un varsayılanı
  // DER; dsaEncoding olmadan Apple imzayı reddeder.
  const signature = signer.sign({
    key: loadKeyPem(),
    dsaEncoding: 'ieee-p1363',
  });

  const jwt = `${signingInput}.${base64url(signature)}`;
  cachedToken = { jwt, issuedAt: now };
  return jwt;
}

function getSession(): ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  const host =
    env.APNS_ENVIRONMENT === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const created = connect(host);
  created.on('error', () => {
    if (session === created) session = null;
  });
  created.on('close', () => {
    if (session === created) session = null;
  });
  session = created;
  return created;
}

export function apnsConfigured(): boolean {
  return Boolean((env.APNS_KEY_P8_PATH || env.APNS_KEY_P8) && env.APNS_KEY_ID && env.APNS_TEAM_ID);
}

interface ApnsResult {
  ok: boolean;
  status?: number;
  /** 410/400 gibi kalıcı hatalarda true — çağıran taraf token'ı silebilir. */
  tokenInvalid?: boolean;
}

/** Tek bir cihaza gönderir. Apple'ın önerdiği gibi bağlantıyı yeniden kullanır. */
export async function sendApnsPush(
  deviceToken: string,
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<ApnsResult> {
  if (!apnsConfigured()) return { ok: false };

  return new Promise((resolve) => {
    let client: ClientHttp2Session;
    try {
      client = getSession();
    } catch {
      resolve({ ok: false });
      return;
    }

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });

    let status = 0;
    req.on('response', (headers) => {
      status = Number(headers[':status']) || 0;
    });
    req.on('data', () => {
      // Gövde (hata JSON'u) burada önemli değil — yalnızca status'a bakıyoruz.
    });
    req.on('end', () => {
      resolve({ ok: status === 200, status, tokenInvalid: status === 400 || status === 410 });
    });
    req.on('error', () => {
      resolve({ ok: false });
    });

    req.end(
      JSON.stringify({
        aps: {
          alert: { title: notification.title, body: notification.body },
          sound: 'default',
          'mutable-content': 1,
        },
        ...(notification.data ?? {}),
      }),
    );
  });
}
