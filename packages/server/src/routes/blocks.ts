/**
 * Engelleme uçları.
 *
 * Arkadaşlıktan bağımsız: kabul/red akışı yok, anında etkili, tek yönlü.
 * Engellemek mevcut arkadaşlığı da siler — Discord'un davranışı budur,
 * engellenen biri "arkadaşım" olarak kalmaya devam etmez.
 */

import type { FastifyInstance } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { GatewayEvent, type APIBlock } from '@tuscord/shared';
import { db } from '../db/index.js';
import { blocks, friendships, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { userId } from '../app.js';
import { publishToUsers } from '../services/events.js';
import { toPublicUser } from '../services/serialize.js';
import { snowflakeParam } from '../lib/validate.js';

export async function blockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** Engellediğim herkes. */
  app.get('/users/@me/blocks', async (request, reply) => {
    const me = userId(request);
    const rows = await db
      .select()
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(eq(blocks.blockerId, me));

    return reply.send(
      rows.map(
        (row): APIBlock => ({
          user: toPublicUser(row.users),
          createdAt: row.blocks.createdAt.toISOString(),
        }),
      ),
    );
  });

  /** Birini engelle — mevcut arkadaşlığı da siler. */
  app.put('/users/@me/blocks/:targetId', async (request, reply) => {
    const me = userId(request);
    const targetId = snowflakeParam(request.params, 'targetId');
    if (targetId === me) throw Errors.badRequest('self_block', 'Kendini engelleyemezsin');

    const target = await db.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!target || target.deletedAt) throw Errors.notFound('unknown_user', 'Kullanıcı bulunamadı');

    await db.insert(blocks).values({ blockerId: me, blockedId: targetId }).onConflictDoNothing();

    // Engellemek arkadaşlığı da bitirir — iki yönde de aranıp silinir.
    await db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, me), eq(friendships.addresseeId, targetId)),
          and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, me)),
        ),
      );

    // Yalnızca kendi cihazlarıma: engellenen kişiye "seni engelledi" bilgisi
    // sızdırılmaz (Discord da göstermiyor), yalnızca arkadaşlık kaldıysa
    // karşı tarafa FRIEND_REMOVE gönderiyoruz — o zaten mevcut bir olay.
    await publishToUsers([targetId.toString()], {
      event: GatewayEvent.FRIEND_REMOVE,
      payload: { userId: me.toString() },
    });

    return reply.status(201).send({
      user: toPublicUser(target),
      createdAt: new Date().toISOString(),
    } satisfies APIBlock);
  });

  /** Engeli kaldır. */
  app.delete('/users/@me/blocks/:targetId', async (request, reply) => {
    const me = userId(request);
    const targetId = snowflakeParam(request.params, 'targetId');

    await db.delete(blocks).where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, targetId)));
    return reply.status(204).send();
  });
}
