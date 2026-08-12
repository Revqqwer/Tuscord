/**
 * 5651 ve KVKK uyum katmanı — Türkiye'de barındırma kararının kod karşılığı.
 *
 * 5651 (yer sağlayıcı): erişime dair trafik bilgisi tutulur ve doğruluğu korunur.
 * KVKK: kişisel veri gerekenden uzun saklanmaz.
 *
 * İkisi birlikte şu anlama gelir: sabit bir saklama süresi belirle
 * (TRAFFIC_LOG_RETENTION_DAYS, varsayılan 365) ve süresi dolanı OTOMATİK sil.
 * "Her ihtimale karşı saklayalım" KVKK ihlalidir; "hiç tutmayalım" 5651 ihlalidir.
 *
 * Kayıt edilen: kim (kullanıcı id), ne zaman, hangi IP/porttan, hangi olay.
 * Kayıt EDİLMEYEN: mesaj içeriği. İçerik burada değil, messages tablosunda ve
 * kaldırma talebi geldiğinde yumuşak silme ile işaretlenir.
 */

import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { trafficLogs } from '../db/schema.js';
import { env } from '../env.js';
import { nextId } from '../lib/id.js';

export type TrafficEventType =
  | 'register'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'session_resume'
  | 'upload'
  | 'password_reset';

export interface TrafficEvent {
  userId?: bigint | null;
  eventType: TrafficEventType;
  ip: string;
  sourcePort?: number | null;
  userAgent?: string | null;
}

/**
 * Trafik kaydı yazar. Hata durumunda isteği DÜŞÜRMEZ — log yazamamak
 * kullanıcının giriş yapamaması anlamına gelmemeli; ama sessiz de kalmaz.
 */
export async function logTraffic(event: TrafficEvent): Promise<void> {
  try {
    await db.insert(trafficLogs).values({
      id: nextId(),
      userId: event.userId ?? null,
      eventType: event.eventType,
      ip: event.ip,
      sourcePort: event.sourcePort ?? null,
      userAgent: event.userAgent ?? null,
    });
  } catch (error) {
    console.error('[uyum] trafik kaydı yazılamadı', error);
  }
}

/**
 * Saklama süresi dolan kayıtları siler. Günlük zamanlanmış görev olarak çalışır.
 * @returns silinen kayıt sayısı
 */
export async function pruneTrafficLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - env.TRAFFIC_LOG_RETENTION_DAYS * 86_400_000);
  const deleted = await db
    .delete(trafficLogs)
    .where(lt(trafficLogs.createdAt, cutoff))
    .returning({ id: trafficLogs.id });
  return deleted.length;
}

/**
 * İstemci IP'si. Cloudflare arkasında çalışacağımız için CF-Connecting-IP
 * öncelikli; yoksa X-Forwarded-For'un İLK adresi (sonrakiler proxy zinciri).
 *
 * Uyarı: bu başlıklar yalnızca güvenilir bir ters proxy arkasındayken
 * anlamlıdır. Sunucu doğrudan internete açıksa istemci bunları uydurabilir.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback: string): string {
  const cf = headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf;

  const xff = headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (typeof raw === 'string' && raw.length > 0) {
    const first = raw.split(',')[0]?.trim();
    if (first) return first;
  }
  return fallback;
}
