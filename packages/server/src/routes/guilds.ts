/**
 * Sunucu (guild) uçları: oluşturma, düzenleme, üyeler, roller.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ChannelType,
  DEFAULT_EVERYONE_PERMISSIONS,
  GatewayEvent,
  Limits,
  Permission,
  computeBasePermissions,
  guildNameError,
  normalizeGuildName,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { redis } from '../redis.js';
import { RedisKeys } from '../lib/redisKeys.js';
import {
  auditLog,
  channels,
  guildMembers,
  guilds,
  memberRoles,
  roles,
  users,
} from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId } from '../app.js';
import {
  assertCanManageMember,
  assertCanManageRole,
  assertPermission,
  requireGuildAccess,
  visibleChannels,
} from '../services/permissions.js';
import { publishToGuild, publishToUsers } from '../services/events.js';
import { buildReadyGuild } from '../services/readyGuild.js';
import { refreshChannelVisibility } from '../services/channelVisibility.js';
import { joinGuild } from '../services/joinGuild.js';
import { detectFileType } from '../services/fileType.js';
import { generateObjectKey, storage } from '../services/storage.js';
import { toAPIChannel, toAPIGuild, toAPIMember, toAPIRole } from '../services/serialize.js';
import { writeAuditLog } from '../services/audit.js';
import { snowflakeParam } from '../lib/validate.js';

/**
 * Ad doğrulaması zod'da DEĞİL, `guildNameError` ile yapılır (bkz.
 * `requireGuildName`); burada yalnızca kaba uzunluk sınırı var.
 */
const createGuildBody = z.object({
  name: z.string().trim().min(1).max(Limits.GUILD_NAME_MAX),
  iconUrl: z.string().url().optional(),
});

const updateGuildBody = z.object({
  name: z.string().trim().min(1).max(Limits.GUILD_NAME_MAX).optional(),
  description: z.string().trim().max(Limits.GUILD_DESCRIPTION_MAX).nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
  systemChannelId: z.string().nullable().optional(),
  wordFilter: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  minAccountAgeHours: z.number().int().min(0).max(720).optional(),
  requireVerifiedEmail: z.boolean().optional(),
});

const roleBody = z.object({
  name: z.string().trim().min(1).max(Limits.ROLE_NAME_MAX),
  color: z.number().int().min(0).max(0xffffff).optional(),
  permissions: z.string().regex(/^\d+$/).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});

/**
 * Sunucu adını doğrular ve normalize edilmiş hâlini döner. Hata kodları kanal
 * adıyla ortak (`channel.errors.*` çevirileri) — kural da ortak.
 */
function requireGuildName(raw: string): string {
  const error = guildNameError(raw);
  if (error === 'too_short') {
    throw Errors.badRequest(
      'guild_name_too_short',
      `Sunucu adı en az ${Limits.GUILD_NAME_MIN} karakter olmalı`,
    );
  }
  if (error === 'invalid_chars') {
    throw Errors.badRequest(
      'guild_name_invalid_chars',
      'Sunucu adı yalnızca harf, rakam, boşluk, tire ve alt çizgi içerebilir',
    );
  }
  if (error === 'too_long') {
    throw Errors.badRequest(
      'guild_name_too_long',
      `Sunucu adı en fazla ${Limits.GUILD_NAME_MAX} karakter olabilir`,
    );
  }
  return normalizeGuildName(raw);
}

/**
 * Herkese açık önizleme: `/davet/<sunucu adı>` akışı bunu kullanır.
 *
 * `guildRoutes` içindeki her rota `requireAuth` arkasında; bu yüzden
 * ayrı bir plugin olarak KAYDEDİLMELİ (bkz. routes/index.ts) — aynı
 * fonksiyona eklenirse hook'u miras alır ve giriş yapmamış ziyaretçi
 * daveti önizleyemez.
 *
 * Davet kodu önizlemesiyle (`GET /invites/:code`) simetrik: giriş
 * zorunlu değil, yalnızca `/guilds/join` (katılma) giriş ister. Bu yeni
 * bir sızıntı yaratmaz — sunucu adıyla katılma zaten davetsiz, herkese
 * açık bir özellik (bkz. `/guilds/join` yorumu).
 */
export async function guildPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/guilds/preview/:name', async (request, reply) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(Limits.GUILD_NAME_MAX) })
      .parse(request.params);

    const guild = await db.query.guilds.findFirst({
      where: sql`lower(${guilds.name}) = lower(${normalizeGuildName(name)})`,
    });
    if (!guild) throw Errors.notFound('unknown_guild', 'Bu isimde bir sunucu yok');

    const memberCount = await db
      .select({ value: count() })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guild.id));

    return reply.send({
      guild: {
        id: guild.id.toString(),
        name: guild.name,
        iconUrl: guild.iconUrl,
        description: guild.description,
      },
      memberCount: memberCount[0]?.value ?? 0,
    });
  });
}

export async function guildRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ---------------- Sunucu oluşturma ---------------- */

  app.post('/guilds', async (request, reply) => {
    const me = userId(request);
    await app.rateLimiter.consume('GUILD_CREATE', me.toString());

    const body = createGuildBody.parse(request.body);
    const guildName = requireGuildName(body.name);

    const existing = await db
      .select({ value: count() })
      .from(guildMembers)
      .where(eq(guildMembers.userId, me));
    if ((existing[0]?.value ?? 0) >= Limits.GUILDS_PER_USER) {
      throw Errors.badRequest('too_many_guilds', 'Sunucu sınırına ulaştın');
    }

    // İsim benzersiz (isimle katılma için); büyük/küçük harf duyarsız kontrol.
    const nameTaken = await db.query.guilds.findFirst({
      where: sql`lower(${guilds.name}) = lower(${guildName})`,
    });
    if (nameTaken) {
      throw Errors.conflict('guild_name_taken', 'Bu isimde bir sunucu zaten var');
    }

    const guildId = nextId();
    const generalId = nextId();
    const memberRoleId = nextId();
    const officerRoleId = nextId();
    const managerRoleId = nextId();

    await db.transaction(async (tx) => {
      await tx.insert(guilds).values({
        id: guildId,
        name: guildName,
        iconUrl: body.iconUrl ?? null,
        ownerId: me,
        systemChannelId: generalId,
      });

      // @everyone rolü: id === guild.id (Discord modeli).
      await tx.insert(roles).values({
        id: guildId,
        guildId,
        name: '@everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      });

      /**
       * Varsayılan 3 basamaklı hiyerarşi — kullanıcı doğrudan atayabilsin
       * diye her yeni sunucuda hazır gelir (elle silinebilir/düzenlenebilir,
       * sabit değil). Sunucu SAHİBİ zaten computeBasePermissions'ta
       * ALL_PERMISSIONS alır (bkz. permissions.ts) — o yüzden ayrı bir
       * "Admin" rolüne gerek yok, "Yönetici" rolü ADMINISTRATOR bitiyle
       * onun eşdeğeri, ama SAHİP OLMAYAN kullanıcılara da verilebilir.
       */
      await tx.insert(roles).values([
        {
          id: memberRoleId,
          guildId,
          name: 'Üye',
          position: 1,
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
        },
        {
          // Üye'nin tüm izinleri + kullanıcılara rol atayıp kaldırabilme
          // (ASSIGN_ROLES). Rol TANIMLARINI düzenleme (MANAGE_ROLES) BİLEREK
          // yok — bu daha hassas bir yetki, yalnızca Yönetici'de (ADMINISTRATOR
          // her şeyi baypas eder) kalsın. Hiyerarşi (position) zaten Subay'ın
          // Yönetici'yi/sahibi yönetmesini engeller.
          id: officerRoleId,
          guildId,
          name: 'Subay',
          position: 2,
          permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.ASSIGN_ROLES,
        },
        {
          // ADMINISTRATOR = computeBasePermissions'ta ALL_PERMISSIONS'a
          // baypas eder (bkz. permissions.ts) — sahiple aynı güçte, ama
          // rol olarak başkasına da verilebilir.
          id: managerRoleId,
          guildId,
          name: 'Yönetici',
          position: 3,
          permissions: Permission.ADMINISTRATOR,
        },
      ]);

      // Kategorisiz, tek bir metin kanalı — sonradan elle oluşturulan
      // kanallardan hiçbir farkı yok (özel bir kategoriye hapsedilmiyor).
      await tx.insert(channels).values({
        id: generalId,
        guildId,
        type: ChannelType.GUILD_TEXT,
        name: 'genel',
        position: 0,
      });

      await tx.insert(guildMembers).values({ guildId, userId: me });
    });

    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });

    // Oluşturana GUILD_CREATE yolla: sunucu, kanalları ve rolleriyle birlikte
    // anında listeye düşsün. Bu olmadan sunucu ancak sayfa yenilenince
    // (bir sonraki READY paketinde) görünürdü.
    const ready = await buildReadyGuild(guildId, me);
    if (ready) {
      await publishToUsers([me.toString()], {
        event: GatewayEvent.GUILD_CREATE,
        payload: ready,
      });
    }

    return reply.status(201).send(toAPIGuild(guild!));
  });

  /* ---------------- İsimle katılma ---------------- */

  /**
   * Sunucuya adıyla katıl (davet linki gerektirmez). İsimler benzersiz olduğu
   * için ad tek bir sunucuya işaret eder. Ban ve raid koruması yine geçerli.
   */
  app.post('/guilds/join', async (request, reply) => {
    const me = userId(request);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(Limits.GUILD_NAME_MAX) })
      .parse(request.body);

    // `normalizeGuildName` yalnızca kenar/iç boşlukları düzenler (bkz. tanım) —
    // "  Deneme   Sunucu  " girdisi kayıtlı "Deneme Sunucu" ile eşleşsin.
    const guild = await db.query.guilds.findFirst({
      where: sql`lower(${guilds.name}) = lower(${normalizeGuildName(name)})`,
    });
    if (!guild) throw Errors.notFound('unknown_guild', 'Bu isimde bir sunucu yok');

    const joined = await joinGuild(guild, me);
    return reply.send(toAPIGuild(joined));
  });

  /* ---------------- İkon / banner yükleme ---------------- */

  app.post('/guilds/:guildId/icon', async (request, reply) => {
    return uploadGuildImage(request, reply, 'icon');
  });
  app.post('/guilds/:guildId/banner', async (request, reply) => {
    return uploadGuildImage(request, reply, 'banner');
  });

  /** Ortak: ikon veya banner yükle (MANAGE_GUILD gerekir, yalnızca görsel). */
  async function uploadGuildImage(
    request: FastifyRequest,
    reply: FastifyReply,
    kind: 'icon' | 'banner',
  ) {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_GUILD);
    await app.rateLimiter.consume('ATTACHMENT_UPLOAD', me.toString());

    const file = await request.file({ limits: { fileSize: Limits.AVATAR_SIZE_MAX, files: 1 } });
    if (!file) throw Errors.badRequest('missing_file', 'Dosya gönderilmedi');
    const buffer = await file.toBuffer().catch(() => null);
    if (!buffer) throw Errors.tooLarge();
    if (file.file.truncated || buffer.byteLength > Limits.AVATAR_SIZE_MAX) {
      throw Errors.tooLarge();
    }
    const type = detectFileType(buffer);
    if (!type || type.kind !== 'image') {
      throw Errors.badRequest('unsupported_file_type', 'Görsel olmalı');
    }

    const objectKey = generateObjectKey('avatars', type.extension);
    await storage.put(objectKey, buffer, type.mime);
    const url = storage.publicUrl(objectKey);

    await db
      .update(guilds)
      .set(kind === 'icon' ? { iconUrl: url } : { bannerUrl: url })
      .where(eq(guilds.id, guildId));

    const updated = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    const payload = toAPIGuild(updated!);
    await publishToGuild({ guildId: guildId.toString(), event: GatewayEvent.GUILD_UPDATE, payload });
    return reply.send(payload);
  }

  /* ---------------- Okuma ---------------- */

  app.get('/guilds/:guildId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);

    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    const visible = await visibleChannels(access.guild, access.member, guildId);
    const roleRows = await db.select().from(roles).where(eq(roles.guildId, guildId));
    const memberCount = await db
      .select({ value: count() })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));

    return reply.send({
      guild: toAPIGuild(guild!),
      channels: visible.map((v) => toAPIChannel(v.channel, { includeOverwrites: v.overwrites })),
      roles: roleRows.map(toAPIRole),
      memberCount: memberCount[0]?.value ?? 0,
      permissions: access.permissions.toString(),
    });
  });

  app.patch('/guilds/:guildId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_GUILD);

    const body = updateGuildBody.parse(request.body);
    const before = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!before) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = requireGuildName(body.name);
    if (body.description !== undefined) patch.description = body.description;
    if (body.iconUrl !== undefined) patch.iconUrl = body.iconUrl;
    if (body.bannerUrl !== undefined) patch.bannerUrl = body.bannerUrl;
    if (body.wordFilter !== undefined) patch.wordFilter = body.wordFilter;
    if (body.minAccountAgeHours !== undefined) patch.minAccountAgeHours = body.minAccountAgeHours;
    if (body.requireVerifiedEmail !== undefined) {
      patch.requireVerifiedEmail = body.requireVerifiedEmail;
    }
    if (body.systemChannelId !== undefined) {
      patch.systemChannelId = body.systemChannelId ? BigInt(body.systemChannelId) : null;
    }
    if (Object.keys(patch).length === 0) return reply.send(toAPIGuild(before));

    const [updated] = await db.update(guilds).set(patch).where(eq(guilds.id, guildId)).returning();

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'guild_update',
      targetId: guildId,
      before,
      after: updated!,
      keys: Object.keys(patch),
    });

    const payload = toAPIGuild(updated!);
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_UPDATE,
      payload,
    });
    return reply.send(payload);
  });

  app.delete('/guilds/:guildId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');
    // Silme yalnızca sahibe ait — ADMINISTRATOR bile sunucuyu silemez.
    if (guild.ownerId !== me) throw Errors.forbidden('owner_only', 'Yalnızca sunucu sahibi silebilir');

    const members = await db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));

    await db.delete(guilds).where(eq(guilds.id, guildId));

    await publishToUsers(
      members.map((m) => m.userId.toString()),
      {
        event: GatewayEvent.GUILD_DELETE,
        payload: { id: guildId.toString(), removed: false },
      },
    );
    return reply.status(204).send();
  });

  /* ---------------- Üyeler ---------------- */

  app.get('/guilds/:guildId/members', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    await requireGuildAccess(guildId, me);

    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(1000).default(200) })
      .parse(request.query);

    const rows = await db
      .select()
      .from(guildMembers)
      .innerJoin(users, eq(users.id, guildMembers.userId))
      .where(eq(guildMembers.guildId, guildId))
      .limit(query.limit);

    const roleRows = await db
      .select()
      .from(memberRoles)
      .where(eq(memberRoles.guildId, guildId));

    const rolesByUser = new Map<string, bigint[]>();
    for (const row of roleRows) {
      const key = row.userId.toString();
      rolesByUser.set(key, [...(rolesByUser.get(key) ?? []), row.roleId]);
    }

    return reply.send(
      rows.map((row) =>
        toAPIMember(row.guild_members, row.users, rolesByUser.get(row.users.id.toString()) ?? []),
      ),
    );
  });

  /**
   * Üyelerin anlık çevrimiçi durumu (presence snapshot).
   *
   * Gateway presence olayları yalnızca DEĞİŞİM anında yayınlanır; üye listesi
   * ilk açıldığında zaten çevrimiçi olanların durumu istemcide bilinmez. Bu uç
   * Redis'teki güncel durumları tek seferde döndürür — sonrası olaylarla akar.
   */
  app.get('/guilds/:guildId/presences', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    await requireGuildAccess(guildId, me);

    const memberRows = await db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId))
      .limit(1000);

    if (memberRows.length === 0) return reply.send([]);

    const ids = memberRows.map((row) => row.userId.toString());
    const statuses = await redis.mget(ids.map((id) => RedisKeys.presence(id)));

    // Redis'te anahtarı olmayan (çevrimdışı) üyeleri atla — istemci varsayılan
    // olarak çevrimdışı sayıyor, boşuna veri göndermeyelim.
    const result = ids
      .map((id, index) => ({ userId: id, status: statuses[index] }))
      .filter((entry): entry is { userId: string; status: string } => entry.status !== null);

    return reply.send(result);
  });

  /**
   * Üyeye rol ver. Rol hiyerarşisi (assertCanManageRole) HER ZAMAN
   * uygulanır — kendine bile olsa kendi konumunun üstündeki/eşiti bir rolü
   * atayamazsın, yetki yükseltmenin klasik yolu budur. Üye hiyerarşisi
   * (assertCanManageMember) yalnızca BAŞKASINA rol atarken devreye girer:
   * kendine rol atamak başka birini "yönetmek" değildir, ASSIGN_ROLES
   * yeterli olmalı (bkz. kullanıcı raporu — daha önce bunu da engelliyordu).
   */
  app.put('/guilds/:guildId/members/:memberId/roles/:roleId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');
    const roleId = snowflakeParam(request.params, 'roleId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.ASSIGN_ROLES);

    const role = access.guild.roles.get(roleId.toString());
    if (!role) throw Errors.notFound('unknown_role', 'Rol bulunamadı');
    assertCanManageRole(access.guild, access.member, role, Permission.ASSIGN_ROLES);
    if (memberId !== me) {
      await assertCanManageMember(access.guild, access.member, memberId);
    }

    await db
      .insert(memberRoles)
      .values({ guildId, userId: memberId, roleId })
      .onConflictDoNothing();

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_role_update',
      targetId: memberId,
      changes: { roles: { before: null, after: roleId.toString() } },
    });

    await emitMemberUpdate(guildId, memberId);
    // Bu rol VIEW_CHANNEL veriyor olabilir — bkz. refreshChannelVisibility yorumu.
    await refreshChannelVisibility(guildId, [memberId]);
    return reply.status(204).send();
  });

  /** Üyeden rol al — hiyerarşi kuralı yukarıdaki PUT ile aynı (bkz. yorum). */
  app.delete('/guilds/:guildId/members/:memberId/roles/:roleId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');
    const roleId = snowflakeParam(request.params, 'roleId');

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.ASSIGN_ROLES);

    const role = access.guild.roles.get(roleId.toString());
    if (!role) throw Errors.notFound('unknown_role', 'Rol bulunamadı');
    assertCanManageRole(access.guild, access.member, role, Permission.ASSIGN_ROLES);
    if (memberId !== me) {
      await assertCanManageMember(access.guild, access.member, memberId);
    }

    await db
      .delete(memberRoles)
      .where(
        and(
          eq(memberRoles.guildId, guildId),
          eq(memberRoles.userId, memberId),
          eq(memberRoles.roleId, roleId),
        ),
      );

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_role_update',
      targetId: memberId,
      changes: { roles: { before: roleId.toString(), after: null } },
    });

    await emitMemberUpdate(guildId, memberId);
    // Bu rol VIEW_CHANNEL veriyordu olabilir — kaybettiyse görünürlük düşsün.
    await refreshChannelVisibility(guildId, [memberId]);
    return reply.status(204).send();
  });

  /** Takma ad. Kendi takma adı için CHANGE_NICKNAME, başkası için MANAGE_NICKNAMES. */
  app.patch('/guilds/:guildId/members/:memberId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const memberId = snowflakeParam(request.params, 'memberId');
    const body = z
      .object({ nickname: z.string().trim().max(Limits.NICKNAME_MAX).nullable() })
      .parse(request.body);

    const access = await requireGuildAccess(guildId, me);
    if (memberId === me) {
      assertPermission(access.permissions, Permission.CHANGE_NICKNAME);
    } else {
      assertPermission(access.permissions, Permission.MANAGE_NICKNAMES);
      await assertCanManageMember(access.guild, access.member, memberId);
    }

    await db
      .update(guildMembers)
      .set({ nickname: body.nickname || null })
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)));

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'member_nickname_update',
      targetId: memberId,
      changes: { nickname: { before: null, after: body.nickname } },
    });

    await emitMemberUpdate(guildId, memberId);
    return reply.status(204).send();
  });

  /** Sunucudan ayrıl. Sahip ayrılamaz — önce sunucuyu devretmeli veya silmeli. */
  app.delete('/guilds/:guildId/members/@me', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) throw Errors.notFound('unknown_guild', 'Sunucu bulunamadı');
    if (guild.ownerId === me) {
      throw Errors.badRequest('owner_cannot_leave', 'Sahip sunucudan ayrılamaz');
    }

    await db
      .delete(guildMembers)
      .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, me)));
    await db
      .delete(memberRoles)
      .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, me)));

    const user = await db.query.users.findFirst({ where: eq(users.id, me) });
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_MEMBER_REMOVE,
      payload: {
        guildId: guildId.toString(),
        user: {
          id: me.toString(),
          username: user!.username,
          discriminator: user!.discriminator,
          displayName: user!.displayName,
          avatarUrl: user!.avatarUrl,
          bio: user!.bio,
          isBot: user!.isBot,
        },
      },
    });
    await publishToUsers([me.toString()], {
      event: GatewayEvent.GUILD_DELETE,
      payload: { id: guildId.toString(), removed: true },
    });
    return reply.status(204).send();
  });

  /* ---------------- Roller ---------------- */

  app.get('/guilds/:guildId/roles', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    await requireGuildAccess(guildId, me);

    const rows = await db.select().from(roles).where(eq(roles.guildId, guildId));
    return reply.send(rows.map(toAPIRole));
  });

  app.post('/guilds/:guildId/roles', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_ROLES);

    const body = roleBody.parse(request.body);
    const requested = body.permissions ? BigInt(body.permissions) : 0n;

    // Sahip olmadığın izni başkasına veremezsin — yetki yükseltmenin klasik yolu.
    const own = computeBasePermissions(access.guild, access.member);
    if ((requested & ~own) !== 0n) {
      throw Errors.forbidden('cannot_grant_permissions', 'Sahip olmadığın izinleri veremezsin');
    }

    const existingCount = await db
      .select({ value: count() })
      .from(roles)
      .where(eq(roles.guildId, guildId));
    if ((existingCount[0]?.value ?? 0) >= Limits.ROLES_PER_GUILD) {
      throw Errors.badRequest('too_many_roles', 'Rol sınırına ulaşıldı');
    }

    // Yeni rol, oluşturanın en yüksek rolünün ALTINA yerleşir.
    const highest = Math.max(
      0,
      ...access.member.roleIds.map((id) => access.guild.roles.get(id)?.position ?? 0),
    );
    const position = access.guild.ownerId === me.toString() ? highest + 1 : Math.max(1, highest);

    const roleId = nextId();
    const [created] = await db
      .insert(roles)
      .values({
        id: roleId,
        guildId,
        name: body.name,
        color: body.color ?? 0,
        permissions: requested,
        hoist: body.hoist ?? false,
        mentionable: body.mentionable ?? false,
        position,
      })
      .returning();

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'role_create',
      targetId: roleId,
      changes: { name: { before: null, after: body.name } },
    });

    const payload = toAPIRole(created!);
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_ROLE_CREATE,
      payload,
    });
    return reply.status(201).send(payload);
  });

  app.patch('/guilds/:guildId/roles/:roleId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const roleId = snowflakeParam(request.params, 'roleId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_ROLES);

    const target =
      roleId === guildId
        ? access.guild.everyoneRole
        : access.guild.roles.get(roleId.toString());
    if (!target) throw Errors.notFound('unknown_role', 'Rol bulunamadı');
    assertCanManageRole(access.guild, access.member, target);

    const body = roleBody.partial().parse(request.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined && roleId !== guildId) patch.name = body.name;
    if (body.color !== undefined) patch.color = body.color;
    if (body.hoist !== undefined) patch.hoist = body.hoist;
    if (body.mentionable !== undefined) patch.mentionable = body.mentionable;
    if (body.permissions !== undefined) {
      const requested = BigInt(body.permissions);
      const own = computeBasePermissions(access.guild, access.member);
      if ((requested & ~own) !== 0n) {
        throw Errors.forbidden('cannot_grant_permissions', 'Sahip olmadığın izinleri veremezsin');
      }
      patch.permissions = requested;
    }
    if (Object.keys(patch).length === 0) {
      const current = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
      return reply.send(toAPIRole(current!));
    }

    const before = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
    const [updated] = await db.update(roles).set(patch).where(eq(roles.id, roleId)).returning();

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'role_update',
      targetId: roleId,
      before: before!,
      after: updated!,
      keys: Object.keys(patch),
    });

    const payload = toAPIRole(updated!);
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_ROLE_UPDATE,
      payload,
    });

    // İzinler değiştiyse (özellikle VIEW_CHANNEL) bu rolü taşıyan üyelerin
    // kanal görünürlüğü de değişmiş olabilir — GUILD_ROLE_UPDATE tek başına
    // bunu yansıtmaz (kanal-özel bir olay değil). Etkilenenlere tam bir
    // READY yenilemesi gönder, sayfa yenilemeye gerek kalmasın.
    if (patch.permissions !== undefined) {
      const affected =
        roleId === guildId
          ? (await db.select({ userId: guildMembers.userId }).from(guildMembers).where(eq(guildMembers.guildId, guildId))).map((r) => r.userId)
          : (
              await db
                .select({ userId: memberRoles.userId })
                .from(memberRoles)
                .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.roleId, roleId)))
            ).map((r) => r.userId);
      await refreshChannelVisibility(guildId, affected);
    }

    return reply.send(payload);
  });

  app.delete('/guilds/:guildId/roles/:roleId', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const roleId = snowflakeParam(request.params, 'roleId');
    if (roleId === guildId) {
      throw Errors.badRequest('cannot_delete_everyone', '@everyone rolü silinemez');
    }

    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_ROLES);
    const target = access.guild.roles.get(roleId.toString());
    if (!target) throw Errors.notFound('unknown_role', 'Rol bulunamadı');
    assertCanManageRole(access.guild, access.member, target);

    // Rolü taşıyan üyeler; olay göndermek için silmeden önce topla.
    const holders = await db
      .select({ userId: memberRoles.userId })
      .from(memberRoles)
      .where(eq(memberRoles.roleId, roleId));

    await db.delete(roles).where(eq(roles.id, roleId));

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'role_delete',
      targetId: roleId,
    });

    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_ROLE_DELETE,
      payload: { guildId: guildId.toString(), roleId: roleId.toString() },
    });
    for (const holder of holders) {
      await emitMemberUpdate(guildId, holder.userId);
    }
    // Silinen rol VIEW_CHANNEL veriyor olabilirdi — bkz. refreshChannelVisibility yorumu.
    await refreshChannelVisibility(
      guildId,
      holders.map((h) => h.userId),
    );
    return reply.status(204).send();
  });

  /* ---------------- Denetim kaydı ---------------- */

  app.get('/guilds/:guildId/audit-log', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.VIEW_AUDIT_LOG);

    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query);

    const rows = await db.query.auditLog.findMany({
      where: eq(auditLog.guildId, guildId),
      orderBy: (t, { desc }) => [desc(t.id)],
      limit: query.limit,
    });

    return reply.send(
      rows.map((row) => ({
        id: row.id.toString(),
        guildId: row.guildId.toString(),
        actorId: row.actorId.toString(),
        actionType: row.actionType,
        targetId: row.targetId?.toString() ?? null,
        changes: row.changes,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  });
}

/** Üye değiştiğinde sunucuya GUILD_MEMBER_UPDATE yayınlar. */
async function emitMemberUpdate(guildId: bigint, memberId: bigint): Promise<void> {
  const membership = await db.query.guildMembers.findFirst({
    where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, memberId)),
  });
  if (!membership) return;

  const user = await db.query.users.findFirst({ where: eq(users.id, memberId) });
  if (!user) return;

  const roleRows = await db
    .select({ roleId: memberRoles.roleId })
    .from(memberRoles)
    .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, memberId)));

  await publishToGuild({
    guildId: guildId.toString(),
    event: GatewayEvent.GUILD_MEMBER_UPDATE,
    payload: toAPIMember(membership, user, roleRows.map((r) => r.roleId)),
  });
}
