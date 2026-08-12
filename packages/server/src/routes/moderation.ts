/**
 * Moderasyon uçları — spec Bölüm 8, Faz 1'de zorunlu.
 *
 * Amaç: bir şikayet veya kaldırma talebi geldiğinde saatler içinde cevap
 * verebilmek. Her eylem denetim kaydına yazılır, her eylem rol hiyerarşisine
 * tabidir, hiçbiri elle izin kontrolü yapmaz.
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { GatewayEvent, Limits, Permission, has } from '@tuscord/shared';
import { db } from '../db/index.js';
import { bans, guildMembers, guilds, memberRoles, messages, reports, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId } from '../app.js';
import {
  assertCanManageMember,
  assertPermission,
  requireGuildAccess,
} from '../services/permissions.js';
import { publishToGuild, publishToUsers } from '../services/events.js';
import { toPublicUser } from '../services/serialize.js';
import { writeAuditLog } from '../services/audit.js';
import { snowflakeParam } from '../lib/validate.js';

const reasonField = z.string().trim().max(512).optional();

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ---------------- Timeout (sustur) ---------------- */

  app.put('/guilds/:guildId/members/:memberId/timeout', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MODERATE_MEMBERS);
    await assertCanManageMember(access.guild, access.member, memberId);

    const body = z
      .object({
        /** Dakika cinsinden süre; 0 = timeout'u kaldır. */
        minutes: z.number().int().min(0).max(Limits.TIMEOUT_MAX_DAYS * 24 * 60),
        reason: reasonField,
      })
      .parse(request.body);

    const until = body.minutes > 0 ? new Date(Date.now() + body.minutes * 60_000) : null;

    await db
      .update(guildMembers)
      .set({ timeoutUntil: until })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)));

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_timeout',
      targetId: memberId,
      reason: body.reason ?? null,
      changes: { timeoutUntil: { before: null, after: until?.toISOString() ?? null } },
    });

    const member = await db.query.guildMembers.findFirst({
      where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)),
    });
    const user = await db.query.users.findFirst({ where: eq(users.id, memberId) });
    const roleRows = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, memberId)));

    if (member && user) {
      await publishToGuild({
        guildId: guildId.toString(),
        event: GatewayEvent.GUILD_MEMBER_UPDATE,
        payload: {
          guildId: guildId.toString(),
          user: toPublicUser(user),
          nickname: member.nickname,
          roles: roleRows.map((r) => r.roleId.toString()),
          joinedAt: member.joinedAt.toISOString(),
          timeoutUntil: member.timeoutUntil?.toISOString() ?? null,
        },
      });
    }
    return reply.status(204).send();
  });

  /* ---------------- Kick (at) ---------------- */

  app.delete('/guilds/:guildId/members/:memberId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.KICK_MEMBERS);
    await assertCanManageMember(access.guild, access.member, memberId);

    const body = z.object({ reason: reasonField }).parse(request.body ?? {});
    const user = await db.query.users.findFirst({ where: eq(users.id, memberId) });
    if (!user) throw Errors.notFound('unknown_member', 'Üye bulunamadı');

    await db
      .delete(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)));
    await db
      .delete(memberRoles)
      .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, memberId)));

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_kick',
      targetId: memberId,
      reason: body.reason ?? null,
    });

    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_MEMBER_REMOVE,
      payload: { guildId: guildId.toString(), user: toPublicUser(user) },
    });
    await publishToUsers([memberId.toString()], {
      event: GatewayEvent.GUILD_DELETE,
      payload: { id: guildId.toString(), removed: true },
    });
    return reply.status(204).send();
  });

  /* ---------------- Ban (yasakla) ---------------- */

  app.get('/guilds/:guildId/bans', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.BAN_MEMBERS);

    const rows = await db
      .select()
      .from(bans)
      .innerJoin(users, eq(users.id, bans.userId))
      .where(eq(bans.guildId, guildId))
      .orderBy(desc(bans.createdAt))
      .limit(500);

    return reply.send(
      rows.map((row) => ({
        guildId: row.bans.guildId.toString(),
        user: toPublicUser(row.users),
        moderatorId: row.bans.moderatorId.toString(),
        reason: row.bans.reason,
        createdAt: row.bans.createdAt.toISOString(),
      })),
    );
  });

  app.put('/guilds/:guildId/bans/:memberId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.BAN_MEMBERS);

    const body = z
      .object({
        reason: reasonField,
        /** Son N günün mesajlarını da sil (0-7). Raid temizliği için. */
        deleteMessageDays: z.number().int().min(0).max(7).default(0),
      })
      .parse(request.body ?? {});

    const user = await db.query.users.findFirst({ where: eq(users.id, memberId) });
    if (!user) throw Errors.notFound('unknown_user', 'Kullanıcı bulunamadı');

    // Üye ise hiyerarşi kontrolü; üye değilse (önceden ayrılmış) doğrudan yasakla.
    const membership = await db.query.guildMembers.findFirst({
      where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)),
    });
    if (membership) {
      await assertCanManageMember(access.guild, access.member, memberId);
    } else {
      const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
      if (guild?.ownerId === memberId) {
        throw Errors.forbidden('owner_immune', 'Sunucu sahibi yasaklanamaz');
      }
    }

    await db
      .insert(bans)
      .values({ guildId, userId: memberId, moderatorId: me, reason: body.reason ?? null })
      .onConflictDoNothing();

    await db
      .delete(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)));
    await db
      .delete(memberRoles)
      .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, memberId)));

    // Raid temizliği: yasaklanan kullanıcının son N gündeki mesajları yumuşak silinir.
    if (body.deleteMessageDays > 0) {
      const cutoff = new Date(Date.now() - body.deleteMessageDays * 86_400_000);
      await db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(messages.guildId, guildId),
            eq(messages.authorId, memberId),
            gte(messages.createdAt, cutoff),
            isNull(messages.deletedAt),
          ),
        );
    }

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_ban',
      targetId: memberId,
      reason: body.reason ?? null,
    });

    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_MEMBER_REMOVE,
      payload: { guildId: guildId.toString(), user: toPublicUser(user) },
    });
    await publishToUsers([memberId.toString()], {
      event: GatewayEvent.GUILD_DELETE,
      payload: { id: guildId.toString(), removed: true },
    });
    return reply.status(204).send();
  });

  app.delete('/guilds/:guildId/bans/:memberId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.BAN_MEMBERS);

    await db.delete(bans).where(and(eq(bans.guildId, guildId), eq(bans.userId, memberId)));
    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_unban',
      targetId: memberId,
    });
    return reply.status(204).send();
  });

  /* ---------------- Raporlar ---------------- */

  app.post('/reports', async (request, reply) => {
    const me = userId(request);
    await app.rateLimiter.consume('REPORT_CREATE', me.toString());

    const body = z
      .object({
        targetType: z.enum(['message', 'user', 'guild']),
        targetId: z.string().regex(/^\d+$/),
        reason: z.string().trim().min(3).max(1000),
      })
      .parse(request.body);

    const targetId = BigInt(body.targetId);

    // Rapor edilen içeriğin anlık kopyası: içerik sonradan silinse de
    // moderatör neyin rapor edildiğini görebilmeli.
    let snapshot: unknown = null;
    if (body.targetType === 'message') {
      const message = await db.query.messages.findFirst({ where: eq(messages.id, targetId) });
      if (message) {
        snapshot = {
          content: message.content,
          authorId: message.authorId.toString(),
          channelId: message.channelId.toString(),
          guildId: message.guildId?.toString() ?? null,
          createdAt: message.createdAt.toISOString(),
        };
      }
    }

    const id = nextId();
    await db.insert(reports).values({
      id,
      reporterId: me,
      targetType: body.targetType,
      targetId,
      reason: body.reason,
      snapshot,
    });

    return reply.status(201).send({ id: id.toString(), status: 'open' });
  });

  /**
   * Rapor kuyruğu. Faz 1'de platform sahibine ait: sunucuda MANAGE_GUILD
   * iznine sahip olma koşulu yerine, raporun hedefi olan sunucunun
   * moderatörlerine açılır. Platform genelindeki kuyruk (site sahibi için)
   * Faz 1.5'te ayrı bir yönetim arayüzüne taşınacak.
   */
  app.get('/guilds/:guildId/reports', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    if (
      !has(access.permissions, Permission.MANAGE_GUILD) &&
      !has(access.permissions, Permission.BAN_MEMBERS)
    ) {
      throw Errors.forbidden();
    }

    const query = z
      .object({ status: z.enum(['open', 'in_review', 'resolved', 'dismissed']).optional() })
      .parse(request.query);

    const rows = await db.query.reports.findMany({
      where: query.status ? eq(reports.status, query.status) : undefined,
      orderBy: [desc(reports.id)],
      limit: 100,
    });

    // Yalnızca bu sunucuya ait raporlar.
    const filtered = rows.filter((row) => {
      const snapshot = row.snapshot as { guildId?: string } | null;
      if (row.targetType === 'guild') return row.targetId === guildId;
      return snapshot?.guildId === guildId.toString();
    });

    return reply.send(
      filtered.map((row) => ({
        id: row.id.toString(),
        reporterId: row.reporterId.toString(),
        targetType: row.targetType,
        targetId: row.targetId.toString(),
        reason: row.reason,
        status: row.status,
        snapshot: row.snapshot,
        handledBy: row.handledBy?.toString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  });

  app.patch('/guilds/:guildId/reports/:reportId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const reportId = snowflakeParam(request.params, 'reportId');
    const access = await requireGuildAccess(guildId, me);
    if (
      !has(access.permissions, Permission.MANAGE_GUILD) &&
      !has(access.permissions, Permission.BAN_MEMBERS)
    ) {
      throw Errors.forbidden();
    }

    const body = z
      .object({ status: z.enum(['open', 'in_review', 'resolved', 'dismissed']) })
      .parse(request.body);

    await db
      .update(reports)
      .set({ status: body.status, handledBy: me, handledAt: new Date() })
      .where(eq(reports.id, reportId));

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'report_handled',
      targetId: reportId,
      changes: { status: { before: null, after: body.status } },
    });
    return reply.status(204).send();
  });
}
