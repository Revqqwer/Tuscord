/**
 * Kanal uçları: oluşturma, düzenleme, silme, sıralama, izin overwrite'ları.
 */

import type { FastifyInstance } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ChannelType,
  GatewayEvent,
  Limits,
  Permission,
  normalizeChannelName,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { channels, permissionOverwrites } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId } from '../app.js';
import {
  assertPermission,
  loadChannelOverwrites,
  requireChannelAccess,
  requireGuildAccess,
} from '../services/permissions.js';
import { publishToGuild } from '../services/events.js';
import { toAPIChannel } from '../services/serialize.js';
import { writeAuditLog } from '../services/audit.js';
import { snowflakeParam } from '../lib/validate.js';

const createChannelBody = z.object({
  name: z.string().trim().min(Limits.CHANNEL_NAME_MIN).max(Limits.CHANNEL_NAME_MAX),
  type: z.union([
    z.literal(ChannelType.GUILD_TEXT),
    z.literal(ChannelType.GUILD_VOICE),
    z.literal(ChannelType.GUILD_CATEGORY),
  ]),
  parentId: z.string().nullable().optional(),
  topic: z.string().trim().max(Limits.CHANNEL_TOPIC_MAX).optional(),
  nsfw: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const updateChannelBody = z.object({
  name: z.string().trim().min(Limits.CHANNEL_NAME_MIN).max(Limits.CHANNEL_NAME_MAX).optional(),
  topic: z.string().trim().max(Limits.CHANNEL_TOPIC_MAX).nullable().optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
  nsfw: z.boolean().optional(),
  slowmodeSeconds: z.number().int().min(0).max(Limits.SLOWMODE_MAX_SECONDS).optional(),
  locked: z.boolean().optional(),
});

const overwriteBody = z.object({
  targetType: z.enum(['role', 'member']),
  allow: z.string().regex(/^\d+$/).default('0'),
  deny: z.string().regex(/^\d+$/).default('0'),
});

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/guilds/:guildId/channels', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_CHANNELS);

    const body = createChannelBody.parse(request.body);

    const existing = await db
      .select({ value: count() })
      .from(channels)
      .where(eq(channels.guildId, guildId));
    if ((existing[0]?.value ?? 0) >= Limits.CHANNELS_PER_GUILD) {
      throw Errors.badRequest('too_many_channels', 'Kanal sınırına ulaşıldı');
    }

    let parentId: bigint | null = null;
    if (body.parentId) {
      parentId = BigInt(body.parentId);
      const parent = await db.query.channels.findFirst({ where: eq(channels.id, parentId) });
      if (!parent || parent.guildId !== guildId || parent.type !== ChannelType.GUILD_CATEGORY) {
        throw Errors.badRequest('invalid_parent', 'Üst kanal geçersiz');
      }
    }

    const channelId = nextId();
    const [created] = await db
      .insert(channels)
      .values({
        id: channelId,
        guildId,
        type: body.type,
        name: normalizeChannelName(body.name),
        topic: body.topic ?? null,
        parentId,
        nsfw: body.nsfw ?? false,
        position: body.position ?? 0,
      })
      .returning();

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'channel_create',
      targetId: channelId,
      changes: { name: { before: null, after: created!.name } },
    });

    const payload = toAPIChannel(created!);
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.CHANNEL_CREATE,
      payload,
      channelId: channelId.toString(),
    });
    return reply.status(201).send(payload);
  });

  app.get('/channels/:channelId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireChannelAccess(channelId, me);

    const overwrites =
      (access.permissions & Permission.MANAGE_CHANNELS) === Permission.MANAGE_CHANNELS
        ? (await loadChannelOverwrites(channelId)).overwrites.map((o) => ({
            targetId: o.targetId,
            targetType: o.targetType,
            allow: o.allow,
            deny: o.deny,
          }))
        : undefined;

    return reply.send(
      toAPIChannel(access.channel, overwrites ? { includeOverwrites: overwrites } : {}),
    );
  });

  app.patch('/channels/:channelId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireChannelAccess(channelId, me);
    assertPermission(access.permissions, Permission.MANAGE_CHANNELS);

    const body = updateChannelBody.parse(request.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = normalizeChannelName(body.name);
    if (body.topic !== undefined) patch.topic = body.topic;
    if (body.position !== undefined) patch.position = body.position;
    if (body.nsfw !== undefined) patch.nsfw = body.nsfw;
    if (body.slowmodeSeconds !== undefined) patch.slowmodeSeconds = body.slowmodeSeconds;
    if (body.locked !== undefined) patch.locked = body.locked;
    if (body.parentId !== undefined) patch.parentId = body.parentId ? BigInt(body.parentId) : null;

    if (Object.keys(patch).length === 0) return reply.send(toAPIChannel(access.channel));

    const [updated] = await db
      .update(channels)
      .set(patch)
      .where(eq(channels.id, channelId))
      .returning();

    await writeAuditLog({
      guildId: access.channel.guildId!,
      actorId: me,
      actionType: 'channel_update',
      targetId: channelId,
      before: access.channel,
      after: updated!,
      keys: Object.keys(patch),
    });

    const payload = toAPIChannel(updated!);
    await publishToGuild({
      guildId: access.channel.guildId!.toString(),
      event: GatewayEvent.CHANNEL_UPDATE,
      payload,
      channelId: channelId.toString(),
    });
    return reply.send(payload);
  });

  app.delete('/channels/:channelId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireChannelAccess(channelId, me);
    assertPermission(access.permissions, Permission.MANAGE_CHANNELS);

    await db.delete(channels).where(eq(channels.id, channelId));

    await writeAuditLog({
      guildId: access.channel.guildId!,
      actorId: me,
      actionType: 'channel_delete',
      targetId: channelId,
      changes: { name: { before: access.channel.name, after: null } },
    });

    await publishToGuild({
      guildId: access.channel.guildId!.toString(),
      event: GatewayEvent.CHANNEL_DELETE,
      payload: {
        id: channelId.toString(),
        guildId: access.channel.guildId!.toString(),
      },
      channelId: channelId.toString(),
    });
    return reply.status(204).send();
  });

  /* ---------------- İzin overwrite'ları ---------------- */

  app.put('/channels/:channelId/permissions/:targetId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const targetId = snowflakeParam(request.params, 'targetId');
    const access = await requireChannelAccess(channelId, me);
    // Overwrite yazmak izin dağıtmaktır: MANAGE_ROLES şart.
    assertPermission(access.permissions, Permission.MANAGE_ROLES);

    const body = overwriteBody.parse(request.body);
    const allow = BigInt(body.allow);
    const deny = BigInt(body.deny);

    // Sahip olmadığın izni ne verebilir ne de kısıtlayabilirsin.
    const own = access.permissions;
    if (((allow | deny) & ~own) !== 0n) {
      throw Errors.forbidden('cannot_grant_permissions', 'Sahip olmadığın izinleri düzenleyemezsin');
    }
    if ((allow & deny) !== 0n) {
      throw Errors.badRequest('conflicting_overwrite', 'Aynı izin hem allow hem deny olamaz');
    }

    await db
      .insert(permissionOverwrites)
      .values({ channelId, targetId, targetType: body.targetType, allow, deny })
      .onConflictDoUpdate({
        target: [
          permissionOverwrites.channelId,
          permissionOverwrites.targetId,
          permissionOverwrites.targetType,
        ],
        set: { allow, deny },
      });

    await writeAuditLog({
      guildId: access.channel.guildId!,
      actorId: me,
      actionType: 'channel_overwrite_update',
      targetId: channelId,
      changes: {
        [`${body.targetType}:${targetId}`]: {
          before: null,
          after: { allow: allow.toString(), deny: deny.toString() },
        },
      },
    });

    // İzin değişti: istemcilerin kanal görünürlüğü de değişmiş olabilir,
    // CHANNEL_UPDATE ile önbelleklerini tazelemelerini sağla.
    await publishToGuild({
      guildId: access.channel.guildId!.toString(),
      event: GatewayEvent.CHANNEL_UPDATE,
      payload: toAPIChannel(access.channel),
      channelId: channelId.toString(),
    });
    return reply.status(204).send();
  });

  app.delete('/channels/:channelId/permissions/:targetId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const targetId = snowflakeParam(request.params, 'targetId');
    const access = await requireChannelAccess(channelId, me);
    assertPermission(access.permissions, Permission.MANAGE_ROLES);

    await db
      .delete(permissionOverwrites)
      .where(
        and(
          eq(permissionOverwrites.channelId, channelId),
          eq(permissionOverwrites.targetId, targetId),
        ),
      );

    await writeAuditLog({
      guildId: access.channel.guildId!,
      actorId: me,
      actionType: 'channel_overwrite_update',
      targetId: channelId,
      changes: { [targetId.toString()]: { before: 'overwrite', after: null } },
    });

    await publishToGuild({
      guildId: access.channel.guildId!.toString(),
      event: GatewayEvent.CHANNEL_UPDATE,
      payload: toAPIChannel(access.channel),
      channelId: channelId.toString(),
    });
    return reply.status(204).send();
  });
}
