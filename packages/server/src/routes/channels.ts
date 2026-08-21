/**
 * Kanal uçları: oluşturma, düzenleme, silme, sıralama, izin overwrite'ları.
 */

import type { FastifyInstance } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import {
  ChannelType,
  GatewayEvent,
  Limits,
  Permission,
  channelNameError,
  isValidChannelSticker,
  normalizeChannelName,
} from '@tuscord/shared';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { channels, guildMembers, memberRoles, permissionOverwrites } from '../db/schema.js';
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
import { refreshChannelVisibility } from '../services/channelVisibility.js';

/**
 * Bir overwrite hedefinin ('role' | 'member') etkilediği üyeler — overwrite
 * değiştiğinde kanal görünürlüğü etkilenmiş olabilecek kişiler (bkz.
 * refreshChannelVisibility yorumu). Rol @everyone ise (targetId === guildId)
 * tüm sunucu üyeleri etkilenir.
 */
async function membersAffectedByOverwrite(
  guildId: bigint,
  targetType: 'role' | 'member',
  targetId: bigint,
): Promise<bigint[]> {
  if (targetType === 'member') return [targetId];
  if (targetId === guildId) {
    const rows = await db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));
    return rows.map((r) => r.userId);
  }
  const rows = await db
    .select({ userId: memberRoles.userId })
    .from(memberRoles)
    .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.roleId, targetId)));
  return rows.map((r) => r.userId);
}

/**
 * Ad doğrulaması zod'da DEĞİL, normalize edilmiş değer üzerinde yapılır
 * (bkz. `channelNameError`); burada yalnızca kaba uzunluk sınırı var.
 */
const createChannelBody = z.object({
  name: z.string().trim().min(1).max(Limits.CHANNEL_NAME_MAX),
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
  name: z.string().trim().min(1).max(Limits.CHANNEL_NAME_MAX).optional(),
  topic: z.string().trim().max(Limits.CHANNEL_TOPIC_MAX).nullable().optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
  nsfw: z.boolean().optional(),
  slowmodeSeconds: z.number().int().min(0).max(Limits.SLOWMODE_MAX_SECONDS).optional(),
  locked: z.boolean().optional(),
  /** Yalnızca sesli kanal; null = kanal id'sinden türetilen varsayılana dön. */
  sticker: z.string().nullable().optional(),
});

const overwriteBody = z.object({
  targetType: z.enum(['role', 'member']),
  allow: z.string().regex(/^\d+$/).default('0'),
  deny: z.string().regex(/^\d+$/).default('0'),
});

/**
 * Adı doğrular ve normalize edilmiş hâlini döner. Hata kodu istemcide
 * `channel.errors.*` çeviri anahtarına karşılık gelir.
 */
function requireChannelName(raw: string): string {
  const error = channelNameError(raw);
  if (error === 'too_short') {
    throw Errors.badRequest(
      'channel_name_too_short',
      `Kanal adı en az ${Limits.CHANNEL_NAME_MIN} karakter olmalı`,
    );
  }
  if (error === 'invalid_chars') {
    throw Errors.badRequest(
      'channel_name_invalid_chars',
      'Kanal adı yalnızca harf, rakam, boşluk, tire ve alt çizgi içerebilir',
    );
  }
  if (error === 'too_long') {
    throw Errors.badRequest('channel_name_too_long', 'Kanal adı çok uzun');
  }
  return normalizeChannelName(raw);
}

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/guilds/:guildId/channels', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);

    const body = createChannelBody.parse(request.body);

    // Oluşturma izni tipe göre ayrılır: metin ve ses kanalı oluşturma ayrı
    // izinler. Kategori bu ikisinin dışında — genel kanal ayarları izniyle
    // (MANAGE_CHANNELS) korunur.
    const creationPermission =
      body.type === ChannelType.GUILD_TEXT
        ? Permission.CREATE_TEXT_CHANNELS
        : body.type === ChannelType.GUILD_VOICE
          ? Permission.CREATE_VOICE_CHANNELS
          : Permission.MANAGE_CHANNELS;
    assertPermission(access.permissions, creationPermission);

    const name = requireChannelName(body.name);

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
        name,
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

    const body = updateChannelBody.parse(request.body);

    // Sıralama (position/parentId) ayrı bir izinle korunur: REORDER_CHANNELS.
    // Ad/konu/kilit/yavaş mod gibi genel ayarlar MANAGE_CHANNELS ister. İstek
    // ikisini birden değiştiriyorsa ikisi de gerekir — kısmi yetkiyle kısmi
    // değişiklik sessizce uygulanmaz.
    const changesOrder = body.position !== undefined || body.parentId !== undefined;
    const changesGeneral =
      body.name !== undefined ||
      body.topic !== undefined ||
      body.nsfw !== undefined ||
      body.slowmodeSeconds !== undefined ||
      body.locked !== undefined ||
      body.sticker !== undefined;
    if (changesOrder) assertPermission(access.permissions, Permission.REORDER_CHANNELS);
    if (changesGeneral) assertPermission(access.permissions, Permission.MANAGE_CHANNELS);

    if (body.sticker !== undefined && body.sticker !== null && !isValidChannelSticker(body.sticker)) {
      throw Errors.badRequest('invalid_sticker', 'Geçersiz sticker');
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = requireChannelName(body.name);
    if (body.topic !== undefined) patch.topic = body.topic;
    if (body.position !== undefined) patch.position = body.position;
    if (body.nsfw !== undefined) patch.nsfw = body.nsfw;
    if (body.slowmodeSeconds !== undefined) patch.slowmodeSeconds = body.slowmodeSeconds;
    if (body.locked !== undefined) patch.locked = body.locked;
    if (body.sticker !== undefined) patch.sticker = body.sticker;
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

  /* ---------------- Ses (LiveKit) ---------------- */

  /**
   * Bu sesli kanala bağlanmak için LiveKit erişim token'ı. Oda adı = kanal
   * id'si (1 sesli kanal = 1 LiveKit odası). CONNECT izni yoksa 403 —
   * istemci bunu `voice.ts` `join()` içinde, gerçek katılmadan HEMEN önce
   * ister (kısa ömürlü token, her katılışta yeniden alınır).
   */
  app.post('/channels/:channelId/voice-token', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireChannelAccess(channelId, me);
    if (access.channel.type !== ChannelType.GUILD_VOICE) {
      throw Errors.badRequest('not_voice_channel', 'Bu bir sesli kanal değil');
    }
    assertPermission(access.permissions, Permission.CONNECT);

    if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
      throw Errors.badRequest('voice_not_configured', 'Sesli sohbet henüz yapılandırılmadı');
    }

    const canSpeak = (access.permissions & Permission.SPEAK) === Permission.SPEAK;
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: me.toString(),
      ttl: '10m',
    });
    at.addGrant({
      room: channelId.toString(),
      roomJoin: true,
      canPublish: canSpeak,
      // Ekran paylaşımı da SPEAK'e bağlı — ayrı bir izin yok, mikrofonla aynı kapı.
      canPublishData: false,
      canSubscribe: true,
    });

    return reply.send({ token: await at.toJwt(), url: env.LIVEKIT_URL });
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
    // CHANNEL_UPDATE ile önbelleklerini tazelemelerini sağla. `includeOverwrites`
    // ŞART — READY paketi zaten overwrite'ları tüm üyelere gönderiyor (bkz.
    // readyGuild.ts), bunu atlamak yalnızca CHANNEL_UPDATE'i tutarsız kılar:
    // istemcinin önbelleğindeki overwrite'lar sıfırlanır (yenisi gelmeden),
    // Rol Ayarları'ndaki "görüntülenecek kanallar" seçici bu yüzden anlık
    // güncellenmezdi.
    await publishToGuild({
      guildId: access.channel.guildId!.toString(),
      event: GatewayEvent.CHANNEL_UPDATE,
      payload: toAPIChannel(access.channel, {
        includeOverwrites: (await loadChannelOverwrites(channelId)).overwrites,
      }),
      channelId: channelId.toString(),
    });

    // Görünürlüğü etkilenmiş olabilecek üyelere tam READY yenilemesi — bkz.
    // membersAffectedByOverwrite/refreshChannelVisibility yorumu. CHANNEL_UPDATE
    // yalnızca ZATEN görebilenlere gider; bu, YENİ görünür/görünmez olanları kapsar.
    await refreshChannelVisibility(
      access.channel.guildId!,
      await membersAffectedByOverwrite(access.channel.guildId!, body.targetType, targetId),
    );
    return reply.status(204).send();
  });

  app.delete('/channels/:channelId/permissions/:targetId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const targetId = snowflakeParam(request.params, 'targetId');
    const access = await requireChannelAccess(channelId, me);
    assertPermission(access.permissions, Permission.MANAGE_ROLES);

    // Görünürlük yenilemesi için silmeden ÖNCE tipini öğren — istek gövdesi
    // targetType taşımıyor (yalnızca targetId).
    const existing = await db.query.permissionOverwrites.findFirst({
      where: and(
        eq(permissionOverwrites.channelId, channelId),
        eq(permissionOverwrites.targetId, targetId),
      ),
    });

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
      payload: toAPIChannel(access.channel, {
        includeOverwrites: (await loadChannelOverwrites(channelId)).overwrites,
      }),
      channelId: channelId.toString(),
    });

    if (existing) {
      await refreshChannelVisibility(
        access.channel.guildId!,
        await membersAffectedByOverwrite(
          access.channel.guildId!,
          existing.targetType as 'role' | 'member',
          targetId,
        ),
      );
    }
    return reply.status(204).send();
  });
}
