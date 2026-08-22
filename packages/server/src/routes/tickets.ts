/**
 * Destek talepleri (ticket).
 *
 * `POST /tickets` KASITLI OLARAK `requireAuth` istemiyor: askıya alınmış bir
 * kullanıcı giriş YAPAMADIĞI için (bkz. auth.ts login: suspendedUntil
 * kontrolü) itiraz etmenin tek yolu oturumsuz bir form — bkz. web
 * SupportScreen.tsx. Giriş yapmış biri destek düğmesinden açtıysa oturumu
 * varsa `userId` de kaydedilir (yalnızca eşleme için, yetki gerekmez).
 *
 * Yönetim uçları (`/admin/tickets/*`) AYRI bir alt-plugin: yalnızca onlar
 * `requireAuth` + `assertAdmin` ister, dış kapsamdaki herkese açık uca
 * sızmaz (Fastify plugin kapsüllemesi).
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ticketMessages, tickets } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { env } from '../env.js';
import { requestIp } from '../app.js';
import { snowflakeParam } from '../lib/validate.js';
import { sendMail, ticketReplyMail } from '../services/mail.js';
import { assertAdmin } from './admin.js';

const createTicketBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(3).max(4000),
});

function toAPITicket(row: typeof tickets.$inferSelect) {
  return {
    id: row.id.toString(),
    number: row.number,
    userId: row.userId?.toString() ?? null,
    email: row.email,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tickets', async (request, reply) => {
    const ip = requestIp(request);
    await app.rateLimiter.consume('TICKET_CREATE', ip);

    const body = createTicketBody.parse(request.body);
    // Oturum varsa (destek düğmesinden, giriş yapmışken açıldıysa) eşle —
    // yoksa (askıya alınmış kullanıcı) null, e-postayla takip edilir.
    const sessionUserId = request.session?.user.id ?? null;

    const id = nextId();
    const [created] = await db
      .insert(tickets)
      .values({
        id,
        userId: sessionUserId,
        email: body.email,
        subject: body.subject,
        status: 'open',
      })
      .returning({ number: tickets.number });
    await db.insert(ticketMessages).values({
      id: nextId(),
      ticketId: id,
      authorType: 'user',
      body: body.message,
    });

    return reply.status(201).send({ id: id.toString(), number: created!.number });
  });

  /**
   * Cloudflare Email Worker'ın info@/destek@ adreslerine gelen mailleri
   * ilettiği uç — bkz. cloudflare-worker/inbound-email/src/index.ts.
   * requireAuth YOK (Worker'ın bizim oturum sistemimizde hesabı yok),
   * bunun yerine paylaşılan bir sır header'ı ile korunuyor.
   *
   * Aynı e-postadan AÇIK/YANITLANMIŞ bir talep varsa yeni mail o talebin
   * thread'ine eklenir (kullanıcı yanıtlamış gibi) — her gelen mail için
   * ayrı bir ticket açmak, aynı konuşmayı parçalara böler.
   */
  app.post('/webhooks/inbound-email', async (request, reply) => {
    if (!env.INBOUND_EMAIL_SECRET || request.headers['x-webhook-secret'] !== env.INBOUND_EMAIL_SECRET) {
      throw Errors.unauthorized();
    }

    const body = z
      .object({
        from: z.string().trim().toLowerCase().email(),
        subject: z.string().trim().max(200).optional(),
        text: z.string().trim().min(1).max(20_000),
      })
      .parse(request.body);

    const subject = body.subject && body.subject.length > 0 ? body.subject : '(konu yok)';
    const message = body.text.slice(0, 4000);

    const existing = await db.query.tickets.findFirst({
      where: and(eq(tickets.email, body.from), inArray(tickets.status, ['open', 'answered'])),
      orderBy: [desc(tickets.id)],
    });

    if (existing) {
      await db.insert(ticketMessages).values({
        id: nextId(),
        ticketId: existing.id,
        authorType: 'user',
        body: message,
      });
      await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, existing.id));
      return reply.status(201).send({ id: existing.id.toString(), number: existing.number });
    }

    const id = nextId();
    const [created] = await db
      .insert(tickets)
      .values({ id, userId: null, email: body.from, subject, status: 'open' })
      .returning({ number: tickets.number });
    await db.insert(ticketMessages).values({ id: nextId(), ticketId: id, authorType: 'user', body: message });

    return reply.status(201).send({ id: id.toString(), number: created!.number });
  });

  await app.register(async (admin) => {
    admin.addHook('preHandler', admin.requireAuth);

    admin.get('/admin/tickets', async (request, reply) => {
      assertAdmin(request);
      const query = z
        .object({ status: z.enum(['open', 'answered', 'closed']).optional() })
        .parse(request.query);

      const rows = await db.query.tickets.findMany({
        where: query.status ? eq(tickets.status, query.status) : undefined,
        orderBy: [desc(tickets.id)],
        limit: 200,
      });
      return reply.send(rows.map(toAPITicket));
    });

    admin.get('/admin/tickets/:ticketId', async (request, reply) => {
      assertAdmin(request);
      const ticketId = snowflakeParam(request.params, 'ticketId');
      const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
      if (!ticket) throw Errors.notFound();

      const messages = await db.query.ticketMessages.findMany({
        where: eq(ticketMessages.ticketId, ticketId),
        orderBy: [ticketMessages.id],
      });

      return reply.send({
        ...toAPITicket(ticket),
        messages: messages.map((m) => ({
          id: m.id.toString(),
          authorType: m.authorType,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    });

    /** Yanıt hem thread'e eklenir hem e-postayla iletilir — kullanıcı çoğu zaman uygulamaya bir daha girmeyebilir. */
    admin.post('/admin/tickets/:ticketId/reply', async (request, reply) => {
      assertAdmin(request);
      const ticketId = snowflakeParam(request.params, 'ticketId');
      const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
      if (!ticket) throw Errors.notFound();

      const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(request.body);

      await db.insert(ticketMessages).values({
        id: nextId(),
        ticketId,
        authorType: 'admin',
        body: body.message,
      });
      await db.update(tickets).set({ status: 'answered' }).where(eq(tickets.id, ticketId));
      await sendMail(
        ticketReplyMail(ticket.email, ticket.number, ticket.subject, body.message),
      ).catch(() => undefined);

      return reply.status(204).send();
    });

    admin.patch('/admin/tickets/:ticketId', async (request, reply) => {
      assertAdmin(request);
      const ticketId = snowflakeParam(request.params, 'ticketId');
      const body = z.object({ status: z.enum(['open', 'answered', 'closed']) }).parse(request.body);

      await db.update(tickets).set({ status: body.status }).where(eq(tickets.id, ticketId));
      return reply.status(204).send();
    });
  });
}
