/**
 * Platform yönetici uçları — yalnızca is_admin=true kullanıcılar.
 *
 * Bunlar sunucu moderatörlüğünden AYRI: platform sahibinin tüm sistemi
 * görebilmesi için. Her uç önce isAdmin kontrol eder; değilse 404 döner
 * (403 değil — admin uçlarının varlığı sıradan kullanıcıya sızmasın).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { guildMembers, guilds, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { userId } from '../app.js';
import { joinGuildById } from '../services/joinGuild.js';
import { toAPIGuild } from '../services/serialize.js';

function assertAdmin(request: FastifyRequest): void {
  if (!request.session?.user.isAdmin) throw Errors.notFound();
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** Tüm kullanıcılar (sayfalı). */
  app.get('/admin/users', async (request, reply) => {
    assertAdmin(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(100) })
      .parse(request.query);

    const rows = await db.query.users.findMany({
      orderBy: (t, { desc: d }) => [d(t.createdAt)],
      limit: query.limit,
    });

    return reply.send(
      rows.map((u) => ({
        id: u.id.toString(),
        username: u.username,
        discriminator: u.discriminator,
        displayName: u.displayName,
        email: u.email,
        emailVerified: u.emailVerified,
        avatarUrl: u.avatarUrl,
        isAdmin: u.isAdmin,
        isDisabled: u.isDisabled,
        deleted: u.deletedAt !== null,
        createdAt: u.createdAt.toISOString(),
      })),
    );
  });

  /** Tüm sunucular + üye sayısı. */
  app.get('/admin/guilds', async (request, reply) => {
    assertAdmin(request);

    const rows = await db
      .select({
        guild: guilds,
        members: count(guildMembers.userId),
      })
      .from(guilds)
      .leftJoin(guildMembers, eq(guildMembers.guildId, guilds.id))
      .groupBy(guilds.id)
      .orderBy(desc(guilds.createdAt))
      .limit(200);

    return reply.send(
      rows.map((row) => ({ ...toAPIGuild(row.guild), memberCount: Number(row.members) })),
    );
  });

  /** Herhangi bir sunucuya admin olarak katıl (moderasyon/inceleme için). */
  app.post('/admin/guilds/:guildId/join', async (request, reply) => {
    assertAdmin(request);
    const me = userId(request);
    const guildId = z
      .object({ guildId: z.string().regex(/^\d+$/) })
      .parse(request.params).guildId;

    const guild = await joinGuildById(BigInt(guildId), me);
    return reply.send(toAPIGuild(guild));
  });
}
