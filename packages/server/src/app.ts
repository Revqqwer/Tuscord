/**
 * Fastify uygulaması: eklentiler, hata işleyici, kimlik doğrulama kancası.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { Limits, type APIError } from '@tuscord/shared';
import { env, isProduction } from './env.js';
import { APIException, Errors } from './lib/errors.js';
import { RateLimiter } from './lib/ratelimit.js';
import { redis } from './redis.js';
import { SESSION_COOKIE, type AuthenticatedSession } from './auth/session.js';
import { resolveAnyToken } from './auth/bot.js';
import { clientIp } from './services/compliance.js';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Kimliği doğrulanmış oturum; `requireAuth` çalıştıysa dolu. */
    session?: AuthenticatedSession;
  }
  interface FastifyInstance {
    rateLimiter: RateLimiter;
    /** preHandler olarak kullanılır: `{ preHandler: app.requireAuth }` */
    requireAuth: (request: FastifyRequest) => Promise<void>;
  }
}

/**
 * Oturumu zorunlu kılmadan çözer — herkese açık uçlarda kullanıcıyı tanımak için.
 *
 * İki kimlik kaynağı: insan tarayıcısı için `SESSION_COOKIE`, bot istemcileri
 * için `Authorization: Bot <token>` header'ı — Discord'daki `Bot <token>`
 * biçimiyle bilinçli olarak aynı, bot geliştirenler için tanıdık.
 */
export async function attachSession(request: FastifyRequest): Promise<void> {
  if (request.session) return;
  const authHeader = request.headers.authorization;
  const botToken = authHeader?.startsWith('Bot ') ? authHeader.slice(4).trim() : null;
  const token = botToken || request.cookies[SESSION_COOKIE];
  if (!token) return;
  const session = await resolveAnyToken(token);
  if (session) request.session = session;
}

export function requestIp(request: FastifyRequest): string {
  return clientIp(request.headers as Record<string, string | string[] | undefined>, request.ip);
}

/** Oturum sahibinin id'si; yoksa fırlatır. Rotalarda kısa kullanım için. */
export function userId(request: FastifyRequest): bigint {
  if (!request.session) throw Errors.unauthorized();
  return request.session.user.id;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: isProduction ? 'info' : 'debug',
      // Kişisel veri loglara sızmasın (KVKK): parola, token, cookie asla yazılmaz.
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
        ],
        remove: true,
      },
    },
    // Cloudflare/Caddy arkasında çalışıyoruz.
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB; dosyalar ayrı uçtan multipart ile gider
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  // Dosya yükleme. Sınır burada da uygulanır: bodyLimit yalnızca JSON içindir.
  await app.register(multipart, {
    limits: { fileSize: Limits.ATTACHMENT_SIZE_MAX, files: 1, fields: 5 },
  });

  if (env.RATE_LIMIT_TRUSTED_IPS.length > 0) {
    app.log.warn(
      { ips: env.RATE_LIMIT_TRUSTED_IPS },
      'RATE_LIMIT_TRUSTED_IPS ayarlı: bu IP\'ler için hız sınırı UYGULANMIYOR. Yayına çıkmadan boşalt.',
    );
  }
  app.decorate(
    'rateLimiter',
    new RateLimiter({ redis, trustedSubjects: new Set(env.RATE_LIMIT_TRUSTED_IPS) }),
  );

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    await attachSession(request);
    if (!request.session) throw Errors.unauthorized();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof APIException) {
      const body: APIError = { error: error.message, code: error.code };
      if (error.fields) body.fields = error.fields;
      const retryAfter = (error as APIException & { retryAfter?: number }).retryAfter;
      if (retryAfter !== undefined) {
        body.retryAfter = retryAfter;
        reply.header('Retry-After', String(retryAfter));
      }
      return reply.status(error.status).send(body);
    }

    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) fields[issue.path.join('.')] = issue.message;
      const body: APIError = { error: 'Doğrulama hatası', code: 'validation_failed', fields };
      return reply.status(400).send(body);
    }

    // Fastify'in kendi doğrulama/parse hataları.
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      const body: APIError = {
        error: fastifyError.message ?? 'Geçersiz istek',
        code: fastifyError.code ?? 'bad_request',
      };
      return reply.status(fastifyError.statusCode).send(body);
    }

    request.log.error(error);
    const body: APIError = { error: 'Sunucu hatası', code: 'internal_error' };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: APIError = { error: 'Bulunamadı', code: 'not_found' };
    return reply.status(404).send(body);
  });

  await registerRoutes(app);

  return app;
}
