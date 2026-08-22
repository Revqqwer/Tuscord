/**
 * Kimlik doğrulama uçları.
 *
 * Güvenlik notları:
 *  - Kullanıcı sayımı (enumeration) engellenir: "e-posta kayıtlı değil" ile
 *    "parola yanlış" AYNI cevabı verir; parola sıfırlama isteği her zaman
 *    başarı döner.
 *  - Hız sınırı IP başına — kaba kuvvet denemesi.
 *  - Her kimlik olayı 5651 trafik kaydına yazılır.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { Limits, USERNAME_PATTERN, isStrongPassword } from '@tuscord/shared';
import { db } from '../db/index.js';
import { users, verificationTokens } from '../db/schema.js';
import { hashPassword, needsRehash, verifyPassword } from '../auth/password.js';
import {
  SESSION_COOKIE,
  createSession,
  destroyAllSessions,
  destroySession,
  sessionCookieOptions,
} from '../auth/session.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { allocateDiscriminator } from '../lib/username.js';
import { env } from '../env.js';
import { logTraffic } from '../services/compliance.js';
import { emailDomainDeliverable } from '../services/email-domain.js';
import { passwordResetMail, sendMail, verificationMail } from '../services/mail.js';
import { toSelfUser } from '../services/serialize.js';
import { attachSession, requestIp } from '../app.js';

/** Kayıtta ve parola değişiminde ortak: uzunluk + en az 1 büyük/küçük harf/rakam. */
const strongPassword = z
  .string()
  .min(Limits.PASSWORD_MIN, `Parola en az ${Limits.PASSWORD_MIN} karakter olmalı`)
  .max(Limits.PASSWORD_MAX)
  .refine(isStrongPassword, 'Parola en az 1 büyük harf, 1 küçük harf ve 1 rakam içermeli');

const registerBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, 'Kullanıcı adı 2-32 karakter, küçük harf/rakam/_/. olmalı'),
  email: z.string().trim().toLowerCase().email('Geçerli bir e-posta gir'),
  password: strongPassword,
  displayName: z.string().trim().max(Limits.DISPLAY_NAME_MAX).optional(),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(Limits.PASSWORD_MAX),
  /** "Beni oturumda tut" — işaretliyse oturum ~1 yıl sürer, aksi hâlde SESSION_TTL_DAYS. */
  remember: z.boolean().optional().default(false),
});

/** "Beni oturumda tut" seçiliyken kullanılan oturum süresi — pratikte "çıkış yapana kadar". */
const REMEMBER_ME_TTL_DAYS = 365;

/** Aynı hesaba art arda parola sıfırlama maili gitmesin diye bekleme süresi. */
const PASSWORD_RESET_COOLDOWN_MIN = 5;

function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Kullanıcı bulunamadığında da doğrulama maliyetini ödemek için kullanılan
 * sahte hash. Gerçek bir argon2id hash olmalı — geçersiz format anında hata
 * verir ve cevap süresi "bu e-posta kayıtlı değil" bilgisini ele verirdi.
 * Bir kez üretilir, süreç boyunca kullanılır.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

async function issueVerificationToken(
  userId: bigint,
  purpose: 'email_verify' | 'password_reset',
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(verificationTokens).values({
    id: nextId(),
    userId,
    purpose,
    tokenHash: hashVerificationToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const ip = requestIp(request);
    await app.rateLimiter.consume('AUTH_REGISTER', ip);

    const body = registerBody.parse(request.body);

    // Alan adı posta alamıyorsa doğrulama maili boşa gider ve hesap hiç
    // açılamaz — kaydı en baştan reddet.
    if (!(await emailDomainDeliverable(body.email))) {
      throw Errors.badRequest(
        'email_domain_invalid',
        'Bu e-posta adresinin alan adı posta kabul etmiyor, adresi kontrol et',
      );
    }

    const existingEmail = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });
    if (existingEmail) {
      // E-posta sayımını engellemek için burada da genel bir çakışma mesajı veriyoruz.
      throw Errors.conflict('registration_failed', 'Bu bilgilerle kayıt yapılamadı');
    }

    const discriminator = await allocateDiscriminator(body.username);
    const id = nextId();

    await db.insert(users).values({
      id,
      username: body.username,
      discriminator,
      displayName: body.displayName ?? null,
      email: body.email,
      passwordHash: await hashPassword(body.password),
    });

    const token = await issueVerificationToken(id, 'email_verify', 24 * 3_600_000);
    await sendMail(
      verificationMail(body.email, `${env.WEB_ORIGIN}/dogrula?token=${token}`),
    ).catch((error) => request.log.error({ error }, 'doğrulama e-postası gönderilemedi'));

    const session = await createSession({
      userId: id,
      ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    await logTraffic({
      userId: id,
      eventType: 'register',
      ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return reply.status(201).send({
      user: {
        id: id.toString(),
        username: body.username,
        discriminator,
        displayName: body.displayName ?? null,
        email: body.email,
        emailVerified: false,
        avatarUrl: null,
        bio: null,
        isBot: false,
        mfaEnabled: false,
        locale: 'tr',
      },
    });
  });

  app.post('/auth/login', async (request, reply) => {
    const ip = requestIp(request);
    await app.rateLimiter.consume('AUTH_LOGIN', ip);

    const body = loginBody.parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });

    // Kullanıcı yoksa da parola doğrulamasına benzer bir gecikme uygulanmalı;
    // aksi halde cevap süresi e-postanın kayıtlı olup olmadığını ele verir.
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await verifyPassword(await dummyHash(), body.password);

    // Bot hesaplarının bilinen bir parolası yok (rastgele/kullanılamaz hash) —
    // passwordOk zaten hep false döner, ama enumeration'a mahal vermemek için
    // aynı genel mesajla aynı yoldan reddet.
    if (!user || !passwordOk || user.isBot) {
      await logTraffic({ userId: user?.id ?? null, eventType: 'login_failed', ip });
      throw Errors.unauthorized('invalid_credentials', 'E-posta veya parola hatalı');
    }
    if (user.isDisabled || user.deletedAt) {
      throw Errors.forbidden('account_disabled', 'Hesap kapatılmış');
    }
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw Errors.forbidden('account_suspended', 'Hesap geçici olarak askıya alınmış', {
        until: user.suspendedUntil.toISOString(),
      });
    }

    // argon2 parametreleri sıkılaştırıldıysa hash'i sessizce güncelle.
    if (needsRehash(user.passwordHash)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.password) })
        .where(eq(users.id, user.id));
    }

    const session = await createSession({
      userId: user.id,
      ip,
      userAgent: request.headers['user-agent'] ?? null,
      ttlDays: body.remember ? REMEMBER_ME_TTL_DAYS : undefined,
    });
    await logTraffic({
      userId: user.id,
      eventType: 'login',
      ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    return reply.send({
      user: toSelfUser({
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
      }),
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await destroySession(token);
      await logTraffic({ eventType: 'logout', ip: requestIp(request) });
    }
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return reply.status(204).send();
  });

  /** İstemci açılışta bunu çağırır: cookie geçerliyse kullanıcıyı döner. */
  app.get('/auth/me', { preHandler: app.requireAuth }, async (request, reply) => {
    return reply.send({ user: toSelfUser(request.session!.user) });
  });

  app.post('/auth/verify-email', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body);
    const tokenHash = hashVerificationToken(token);

    const row = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.tokenHash, tokenHash),
        eq(verificationTokens.purpose, 'email_verify'),
        isNull(verificationTokens.usedAt),
      ),
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw Errors.badRequest('invalid_token', 'Bağlantı geçersiz veya süresi dolmuş');
    }

    await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
    await db
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(verificationTokens.id, row.id));

    return reply.status(204).send();
  });

  /**
   * Doğrulama e-postasını yeniden gönder — kayıt sırasındaki gönderim
   * başarısız olduysa (SMTP geçici hata vb.) ya da kullanıcı maili
   * bulamadıysa. Aynı enumeration-önleme ilkesi: hesap yoksa/zaten
   * doğrulanmışsa da her zaman aynı 204 döner (bkz. request-password-reset).
   */
  app.post('/auth/resend-verification', async (request, reply) => {
    const ip = requestIp(request);
    await app.rateLimiter.consume('AUTH_RESEND_VERIFY', ip);

    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });

    if (user && !user.deletedAt && !user.emailVerified) {
      const token = await issueVerificationToken(user.id, 'email_verify', 24 * 3_600_000);
      await sendMail(
        verificationMail(email, `${env.WEB_ORIGIN}/dogrula?token=${token}`),
      ).catch((error) => request.log.error({ error }, 'doğrulama e-postası gönderilemedi'));
    }

    return reply.status(204).send();
  });

  app.post('/auth/request-password-reset', async (request, reply) => {
    const ip = requestIp(request);
    await app.rateLimiter.consume('AUTH_PASSWORD_RESET', ip);

    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });

    if (user && !user.deletedAt) {
      // Hesap-bazlı bekleme: IP hız sınırı (yukarıda) tek bir kişinin çok
      // hızlı denemesini engeller ama farklı IP'lerden (ör. mobil veri +
      // wifi) aynı hesaba art arda mail gitmesini engellemez. Token TTL'i
      // 1 saat (aşağıda); son PASSWORD_RESET_COOLDOWN_MIN içinde verilmiş,
      // hâlâ geçerli bir token varsa yeni mail YOLLANMAZ — ama enumeration
      // sızdırmamak için cevap yine de 204.
      const stillFresh = new Date(Date.now() + (60 - PASSWORD_RESET_COOLDOWN_MIN) * 60_000);
      const recent = await db.query.verificationTokens.findFirst({
        where: and(
          eq(verificationTokens.userId, user.id),
          eq(verificationTokens.purpose, 'password_reset'),
          isNull(verificationTokens.usedAt),
          gt(verificationTokens.expiresAt, stillFresh),
        ),
      });

      if (!recent) {
        const token = await issueVerificationToken(user.id, 'password_reset', 3_600_000);
        await sendMail(
          passwordResetMail(email, `${env.WEB_ORIGIN}/parola-sifirla?token=${token}`),
        ).catch((error) => request.log.error({ error }, 'sıfırlama e-postası gönderilemedi'));
      }
    }

    // Hesap var mı yok mu belli olmasın: her durumda aynı cevap.
    return reply.status(204).send();
  });

  app.post('/auth/reset-password', async (request, reply) => {
    // requireAuth DEĞİL — bu uç oturumsuz da (klasik "parolamı unuttum")
    // çalışmalı. Ama oturum varsa (profil ayarlarından "parolayı değiştir"
    // tetiklendiyse, aynı tarayıcıda) mevcut parolayı da isteyebilelim diye
    // elle çözüyoruz — bkz. aşağısı.
    await attachSession(request);

    const { token, password, currentPassword } = z
      .object({
        token: z.string().min(1),
        password: strongPassword,
        currentPassword: z.string().optional(),
      })
      .parse(request.body);

    const tokenHash = hashVerificationToken(token);
    const row = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.tokenHash, tokenHash),
        eq(verificationTokens.purpose, 'password_reset'),
        isNull(verificationTokens.usedAt),
      ),
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw Errors.badRequest('invalid_token', 'Bağlantı geçersiz veya süresi dolmuş');
    }

    // Token'ın sahibiyle şu an oturum açmış kişi AYNIYSA (profil
    // ayarlarından tetiklenen değişim) — ekstra doğrulama olarak mevcut
    // parola da istenir. Oturumsuzsa (klasik "parolamı unuttum") atlanır —
    // zaten hatırlamadığı için sıfırlıyor.
    if (request.session && request.session.user.id === row.userId) {
      if (!currentPassword) {
        throw Errors.badRequest('current_password_required', 'Mevcut parolanı gir');
      }
      const currentUser = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      const ok = currentUser && (await verifyPassword(currentUser.passwordHash, currentPassword));
      if (!ok) throw Errors.badRequest('wrong_current_password', 'Mevcut parola yanlış');
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, row.userId));
    await db
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(verificationTokens.id, row.id));

    // Parola değişti: tüm cihazlardan çıkış. Hesap ele geçirilmişse saldırganın
    // oturumu de düşer.
    await destroyAllSessions(row.userId);
    await logTraffic({ userId: row.userId, eventType: 'password_reset', ip: requestIp(request) });

    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return reply.status(204).send();
  });
}
