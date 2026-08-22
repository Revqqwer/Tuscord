/**
 * Oturum yönetimi.
 *
 * Tasarım: token istemcide HttpOnly cookie'de durur; sunucuda yalnızca
 * SHA-256 özeti saklanır. Veritabanı sızarsa token'lar kullanılamaz.
 *
 * Redis birincil arama yoludur (her istekte Postgres'e gitmemek için),
 * Postgres kalıcı kayıttır: kullanıcı "açık oturumlarım" listesini görebilsin
 * ve Redis uçarsa oturumlar kaybolmasın.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { GatewayEvent } from '@tuscord/shared';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { redis, RedisKeys } from '../redis.js';
import { env } from '../env.js';
import { nextId } from '../lib/id.js';
import { publishToUsers } from '../services/events.js';

export const SESSION_COOKIE = 'tuscord_session';

export interface SessionUser {
  id: bigint;
  username: string;
  discriminator: string;
  displayName: string | null;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  bio: string | null;
  locale: string;
  isBot: boolean;
  mfaEnabled: boolean;
  isAdmin: boolean;
}

export interface AuthenticatedSession {
  sessionId: bigint;
  user: SessionUser;
}

/** Redis'te tutulan minimal kayıt — her istekte JOIN yapmamak için. */
interface CachedSession {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

export function generateToken(): string {
  // 32 bayt = 256 bit entropi. base64url: URL ve cookie güvenli.
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sabit zamanlı karşılaştırma — token doğrulamasında zamanlama sızıntısını önler. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface CreateSessionInput {
  userId: bigint;
  ip?: string | null;
  userAgent?: string | null;
  /** Verilmezse env.SESSION_TTL_DAYS kullanılır — "beni oturumda tut" bunu ezer. */
  ttlDays?: number;
}

/**
 * Aynı anda yalnızca bir oturum: yeni giriş, tarayıcı/masaüstü fark
 * etmeksizin önceki TÜM oturumları düşürür (bkz. kullanıcı isteği). Yalnızca
 * veritabanı satırını silmek yetmez — eski istemci hâlâ gateway'e bağlıysa
 * bir sonraki REST isteğine kadar çalışmaya devam ederdi; bu yüzden
 * SESSION_INVALIDATED ile anında koparılır (bkz. useGateway.ts).
 *
 * Kayıt akışında da çağrılır ama orada zaten önceki oturum yoktur —
 * `destroyAllSessions`/yayın no-op olur, zararsız.
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<{ token: string; sessionId: bigint; expiresAt: Date }> {
  await destroyAllSessions(input.userId);

  const token = generateToken();
  const tokenHash = hashToken(token);
  const sessionId = nextId();
  const ttlDays = input.ttlDays ?? env.SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

  await db.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    tokenHash,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    expiresAt,
  });

  const cached: CachedSession = {
    sessionId: sessionId.toString(),
    userId: input.userId.toString(),
    expiresAt: expiresAt.getTime(),
  };
  await redis.set(RedisKeys.session(tokenHash), JSON.stringify(cached), 'EX', ttlDays * 86_400);

  await publishToUsers([input.userId.toString()], {
    event: GatewayEvent.SESSION_INVALIDATED,
    payload: {},
  });

  return { token, sessionId, expiresAt };
}

/**
 * Token'ı çözer. Geçersiz/süresi dolmuş token için null döner — asla fırlatmaz;
 * çağıran taraf isteğe bağlı kimlik doğrulama da yapabilsin.
 */
export async function resolveSession(token: string): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(token);

  let userId: bigint;
  let sessionId: bigint;

  const cachedRaw = await redis.get(RedisKeys.session(tokenHash));
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedSession;
    if (cached.expiresAt <= Date.now()) {
      await destroySessionByHash(tokenHash);
      return null;
    }
    userId = BigInt(cached.userId);
    sessionId = BigInt(cached.sessionId);
  } else {
    // Redis'te yok — Postgres'e düş ve önbelleği yeniden doldur.
    const row = await db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, tokenHash),
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;

    userId = row.userId;
    sessionId = row.id;
    const ttl = Math.floor((row.expiresAt.getTime() - Date.now()) / 1000);
    if (ttl > 0) {
      const cached: CachedSession = {
        sessionId: sessionId.toString(),
        userId: userId.toString(),
        expiresAt: row.expiresAt.getTime(),
      };
      await redis.set(RedisKeys.session(tokenHash), JSON.stringify(cached), 'EX', ttl);
    }
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.isDisabled || user.deletedAt) {
    await destroySessionByHash(tokenHash);
    return null;
  }

  return {
    sessionId,
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      locale: user.locale,
      isBot: user.isBot,
      mfaEnabled: user.mfaSecret !== null,
      isAdmin: user.isAdmin,
    },
  };
}

export async function destroySession(token: string): Promise<void> {
  await destroySessionByHash(hashToken(token));
}

async function destroySessionByHash(tokenHash: string): Promise<void> {
  await Promise.all([
    redis.del(RedisKeys.session(tokenHash)),
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)),
  ]);
}

/** Parola değişikliğinde veya hesap ele geçirildiğinde: tüm cihazlardan çıkış. */
export async function destroyAllSessions(userId: bigint, exceptSessionId?: bigint): Promise<void> {
  const rows = await db.select({ tokenHash: sessions.tokenHash, id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  const toDelete = rows.filter((r) => r.id !== exceptSessionId);
  if (toDelete.length === 0) return;

  await redis.del(...toDelete.map((r) => RedisKeys.session(r.tokenHash)));
  for (const row of toDelete) {
    await db.delete(sessions).where(eq(sessions.id, row.id));
  }
}

/**
 * Bir platform yöneticisi hesabı yasakladığında/sildiğinde: oturumları
 * düşürmek TEK BAŞINA yetmez — kullanıcı hâlâ gateway'e bağlıysa (canlı
 * WebSocket) sayfayı yenileyene kadar bağlı kalıp mesaj yazmaya devam
 * edebilir (bkz. kullanıcı raporu). FORCE_LOGOUT ile bağlı istemci ANINDA
 * kendini oturumdan düşürür — SESSION_INVALIDATED ile aynı mekanizma,
 * yalnızca sebep farklı (bkz. useGateway.ts).
 */
export async function forceLogoutUser(
  userId: bigint,
  reason: 'account_banned' | 'account_deleted' | 'account_suspended',
): Promise<void> {
  await destroyAllSessions(userId);
  await publishToUsers([userId.toString()], {
    event: GatewayEvent.FORCE_LOGOUT,
    payload: { reason },
  });
}

/** Süresi dolmuş kayıtları temizler — zamanlanmış görev olarak çalışır. */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return deleted.length;
}

export function sessionCookieOptions(expiresAt?: Date) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // 'lax': OAuth benzeri üçüncü taraf yönlendirmesi yok, CSRF'ye karşı yeterli.
    sameSite: 'lax' as const,
    domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}
