/**
 * Rapor tabanlı otomatik askıya alma.
 *
 * `isDisabled` (bkz. schema.ts users) kalıcı ve yalnızca admin geri alır —
 * bu tamamen ayrı, OTOMATİK ve GEÇİCİ bir mekanizma: kısa sürede çok rapor
 * alan bir hesap kendiliğinden `SUSPENSION_HOURS` süreliğine kilitlenir,
 * süre dolunca hiçbir admin işlemi gerekmeden normale döner (bkz.
 * routes/auth.ts login kontrolü: `suspendedUntil > now`).
 */

import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reports, users } from '../db/schema.js';
import { forceLogoutUser } from '../auth/session.js';
import { sendMail } from './mail.js';
import { suspensionMail } from './mail.js';

/** Bu kadar (dismissed hariç) rapor birikirse askıya alınır. */
const REPORT_THRESHOLD = 5;
/** Sayım penceresi — bu süreden eski raporlar sayılmaz. */
const REPORT_WINDOW_DAYS = 7;
/** Askı süresi. */
const SUSPENSION_HOURS = 24;

/**
 * Bir raporun asıl hedef KULLANICISI kim — targetType='user' ise doğrudan
 * targetId, 'message' ise mesajın yazarı (snapshot'tan, mesaj silinmiş
 * olabilir), 'guild' ise kullanıcı hedefi yok (null).
 */
export function resolveReportTargetUserId(
  targetType: 'message' | 'user' | 'guild',
  targetId: bigint,
  snapshot: unknown,
): bigint | null {
  if (targetType === 'user') return targetId;
  if (targetType === 'message') {
    const authorId = (snapshot as { authorId?: string } | null)?.authorId;
    if (!authorId) return null;
    try {
      return BigInt(authorId);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Yeni bir rapor kaydedildikten SONRA çağrılır — eşik aşıldıysa hesabı
 * askıya alır, canlı oturumları düşürür ve bilgilendirme e-postası gönderir.
 * Zaten (daha uzun/eşit bir süreye) askılıysa dokunmaz — kısaltmaz.
 */
export async function maybeAutoSuspend(targetUserId: bigint): Promise<void> {
  const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 3_600_000);
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(
        eq(reports.resolvedUserId, targetUserId),
        ne(reports.status, 'dismissed'),
        gte(reports.createdAt, since),
      ),
    );

  if ((row?.value ?? 0) < REPORT_THRESHOLD) return;

  const target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
  if (!target || target.deletedAt || target.isDisabled) return;

  const now = new Date();
  if (target.suspendedUntil && target.suspendedUntil > now) return;

  const until = new Date(now.getTime() + SUSPENSION_HOURS * 3_600_000);
  await db.update(users).set({ suspendedUntil: until }).where(eq(users.id, targetUserId));
  await forceLogoutUser(targetUserId, 'account_suspended');
  await sendMail(suspensionMail(target.email, until)).catch(() => undefined);
}
