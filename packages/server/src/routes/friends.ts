/**
 * Arkadaşlık uçları.
 *
 * Kullanıcılar birbirini `kullanıcıadı#dördül` etiketiyle (Discord modeli)
 * ekler. Etiket benzersizdir — kullanıcı adı tek başına değil, dördül ile
 * birlikte tekil.
 *
 * İlişki tek satır: requester → addressee, status pending/accepted. Kabul
 * yalnızca addressee tarafından yapılabilir.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { GatewayEvent, type APIFriendship } from '@tuscord/shared';
import { db } from '../db/index.js';
import { friendships, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { userId } from '../app.js';
import { publishToUsers } from '../services/events.js';
import { toPublicUser } from '../services/serialize.js';
import { snowflakeParam } from '../lib/validate.js';
import type { User } from '../db/schema.js';

/** `kullanıcıadı#1234` → { username, discriminator } */
const TAG = /^(.+)#(\d{4})$/;

function friendshipDTO(row: typeof friendships.$inferSelect, other: User, viewerId: bigint): APIFriendship {
  return {
    user: toPublicUser(other),
    status: row.status as APIFriendship['status'],
    // Bekleyen istekte yön: isteği ben mi gönderdim, bana mı geldi.
    direction: row.requesterId === viewerId ? 'outgoing' : 'incoming',
    createdAt: row.createdAt.toISOString(),
  };
}

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** Kabul edilmiş arkadaşlar + bekleyen istekler (iki yön). */
  app.get('/users/@me/friends', async (request, reply) => {
    const me = userId(request);
    const rows = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, me), eq(friendships.addresseeId, me)));

    if (rows.length === 0) return reply.send([]);

    const otherIds = rows.map((r) => (r.requesterId === me ? r.addresseeId : r.requesterId));
    const others = await db.query.users.findMany({
      where: (t, { inArray }) => inArray(t.id, otherIds),
    });
    const byId = new Map(others.map((u) => [u.id.toString(), u]));

    return reply.send(
      rows
        .map((row) => {
          const otherId = row.requesterId === me ? row.addresseeId : row.requesterId;
          const other = byId.get(otherId.toString());
          return other ? friendshipDTO(row, other, me) : null;
        })
        .filter((x): x is APIFriendship => x !== null),
    );
  });

  /** Etiketle arkadaşlık isteği gönder. */
  app.post('/users/@me/friends', async (request, reply) => {
    const me = userId(request);
    const { tag } = z.object({ tag: z.string().trim().min(3).max(40) }).parse(request.body);

    const match = TAG.exec(tag);
    if (!match) throw Errors.badRequest('invalid_tag', 'Etiket kullanıcıadı#1234 biçiminde olmalı');
    const [, username, discriminator] = match;

    const target = await db.query.users.findFirst({
      where: and(
        eq(users.username, username!.toLowerCase()),
        eq(users.discriminator, discriminator!),
      ),
    });
    if (!target || target.deletedAt) throw Errors.notFound('unknown_user', 'Bu etiketle kullanıcı bulunamadı');
    if (target.id === me) throw Errors.badRequest('self_friend', 'Kendini ekleyemezsin');

    // Zaten bir ilişki var mı (her iki yönde)?
    const existing = await db.query.friendships.findFirst({
      where: or(
        and(eq(friendships.requesterId, me), eq(friendships.addresseeId, target.id)),
        and(eq(friendships.requesterId, target.id), eq(friendships.addresseeId, me)),
      ),
    });
    if (existing) {
      // Karşı taraf bana zaten istek göndermişse, bu istek kabul anlamına gelir.
      if (existing.status === 'pending' && existing.addresseeId === me) {
        return acceptFriend(me, target.id, reply);
      }
      throw Errors.conflict('already_related', 'Zaten bir arkadaşlık ilişkiniz var');
    }

    await db.insert(friendships).values({ requesterId: me, addresseeId: target.id, status: 'pending' });

    const meUser = await db.query.users.findFirst({ where: eq(users.id, me) });
    const row = { requesterId: me, addresseeId: target.id, status: 'pending' as const, createdAt: new Date() };

    // Karşı tarafa "sana istek geldi", bana "gönderildi".
    await publishToUsers([target.id.toString()], {
      event: GatewayEvent.FRIEND_UPSERT,
      payload: friendshipDTO(row, meUser!, target.id),
    });
    return reply.status(201).send(friendshipDTO(row, target, me));
  });

  /** Bekleyen isteği kabul et (yalnızca alıcı). */
  app.put('/users/@me/friends/:targetId', async (request, reply) => {
    const me = userId(request);
    const targetId = snowflakeParam(request.params, 'targetId');
    return acceptFriend(me, targetId, reply);
  });

  /** İsteği reddet, arkadaşlığı sil, ya da giden isteği geri çek. */
  app.delete('/users/@me/friends/:targetId', async (request, reply) => {
    const me = userId(request);
    const targetId = snowflakeParam(request.params, 'targetId');

    await db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, me), eq(friendships.addresseeId, targetId)),
          and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, me)),
        ),
      );

    await publishToUsers([targetId.toString()], {
      event: GatewayEvent.FRIEND_REMOVE,
      payload: { userId: me.toString() },
    });
    return reply.status(204).send();
  });

  /** Ortak kabul mantığı — hem PUT hem "karşılıklı istek" durumundan çağrılır. */
  async function acceptFriend(me: bigint, targetId: bigint, reply: FastifyReply) {
    const request = await db.query.friendships.findFirst({
      where: and(
        eq(friendships.requesterId, targetId),
        eq(friendships.addresseeId, me),
        eq(friendships.status, 'pending'),
      ),
    });
    if (!request) throw Errors.notFound('no_request', 'Bekleyen istek yok');

    await db
      .update(friendships)
      .set({ status: 'accepted' })
      .where(and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, me)));

    const [meUser, targetUser] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, me) }),
      db.query.users.findFirst({ where: eq(users.id, targetId) }),
    ]);
    const row = { ...request, status: 'accepted' as const };

    // İki tarafa da "artık arkadaşsınız".
    await publishToUsers([targetId.toString()], {
      event: GatewayEvent.FRIEND_UPSERT,
      payload: friendshipDTO(row, meUser!, targetId),
    });
    return reply.send(friendshipDTO(row, targetUser!, me));
  }
}
