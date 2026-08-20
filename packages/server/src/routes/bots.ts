/**
 * Bot uygulamaları — "Geliştirici Portalı" ve sunucuya bot ekleme.
 *
 * Discord'a bilinçli paralellik: bir insan kullanıcı bir "Application"
 * (burada: bot_applications satırı + token) oluşturur, bu uygulamanın
 * arkasında ayrı bir `isBot: true` kullanıcı vardır. Bot bir sunucuya
 * normal bir ÜYE gibi eklenir (guild_members satırı + kendi rolü) — mesaj/
 * izin/gateway sistemlerinin HİÇBİRİ bot için özel dallanmaz, hepsi zaten
 * "bir kullanıcı" üzerinden çalışıyor.
 *
 * Botu sunucudan çıkarmak için AYRI bir uç YOK — mevcut
 * `DELETE /guilds/:guildId/members/:memberId` (moderation.ts) zaten
 * çalışır, çünkü bot da bir guild_members satırından ibaret.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  GatewayEvent,
  Limits,
  Permission,
  USERNAME_PATTERN,
  computeBasePermissions,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import { bans, botApplications, guildMembers, memberRoles, roles, users } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { hashToken } from '../auth/session.js';
import { generateBotToken } from '../auth/bot.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { allocateDiscriminator } from '../lib/username.js';
import { userId } from '../app.js';
import { assertPermission, requireGuildAccess } from '../services/permissions.js';
import { refreshChannelVisibility } from '../services/channelVisibility.js';
import { publishToGuild } from '../services/events.js';
import { writeAuditLog } from '../services/audit.js';
import { toAPIBotApplication, toAPIMember, toAPIRole, toPublicUser } from '../services/serialize.js';
import { snowflakeParam } from '../lib/validate.js';

const createAppBody = z.object({
  name: z.string().trim().min(2).max(Limits.BOT_NAME_MAX),
});

const addBotBody = z.object({
  applicationId: z.string().regex(/^\d+$/),
  permissions: z.string().regex(/^\d+$/),
});

/** Bot görünen adından bir kullanıcı adı üretir — @everyone'daki gibi 2-32, küçük harf/rakam/_/.  */
function slugifyBotUsername(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, Limits.USERNAME_MAX);
  if (slug.length >= Limits.USERNAME_MIN && USERNAME_PATTERN.test(slug)) return slug;
  return `bot${randomBytes(3).toString('hex')}`;
}

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ---------------- Geliştirici portalı ---------------- */

  app.post('/developers/applications', async (request, reply) => {
    const me = userId(request);
    if (request.session!.user.isBot) throw Errors.forbidden();

    const owned = await db
      .select({ value: count() })
      .from(botApplications)
      .where(eq(botApplications.ownerId, me));
    if ((owned[0]?.value ?? 0) >= Limits.BOT_APPS_PER_USER) {
      throw Errors.badRequest('too_many_applications', 'Uygulama sınırına ulaştın');
    }

    const body = createAppBody.parse(request.body);
    const botUsername = slugifyBotUsername(body.name);
    const discriminator = await allocateDiscriminator(botUsername);
    const botUserId = nextId();
    const appId = nextId();

    await db.insert(users).values({
      id: botUserId,
      username: botUsername,
      discriminator,
      displayName: body.name,
      // Sentetik ve benzersiz (id'ye bağlı) — bota gerçek bir e-posta gerekmiyor,
      // giriş ekranından zaten hiç ulaşılamıyor (bkz. auth.ts login: isBot reddi).
      email: `bot-${botUserId}@bots.tuscord.internal`,
      emailVerified: true,
      // Kimse bilmiyor, kimse kullanmayacak — giriş yolu zaten kapalı.
      passwordHash: await hashPassword(randomBytes(32).toString('hex')),
      isBot: true,
    });

    const token = generateBotToken();
    await db.insert(botApplications).values({
      id: appId,
      ownerId: me,
      botUserId,
      name: body.name,
      tokenHash: hashToken(token),
    });

    const botUser = (await db.query.users.findFirst({ where: eq(users.id, botUserId) }))!;
    const created = (await db.query.botApplications.findFirst({ where: eq(botApplications.id, appId) }))!;
    return reply.status(201).send({ ...toAPIBotApplication(created, botUser), token });
  });

  app.get('/developers/applications', async (request, reply) => {
    const me = userId(request);
    const rows = await db.select().from(botApplications).where(eq(botApplications.ownerId, me));
    if (rows.length === 0) return reply.send([]);

    const botUsers = await db
      .select()
      .from(users)
      .where(inArray(users.id, rows.map((r) => r.botUserId)));
    const byId = new Map(botUsers.map((u) => [u.id.toString(), u]));

    return reply.send(
      rows
        .map((r) => {
          const botUser = byId.get(r.botUserId.toString());
          return botUser ? toAPIBotApplication(r, botUser) : null;
        })
        .filter((x) => x !== null),
    );
  });

  /**
   * Herkese açık uygulama bilgisi (isim + avatar) — davet ekranının bot
   * sahibi OLMAYAN bir sunucu yöneticisine "bu botu ekliyorsun" gösterebilmesi
   * için sahiplik kontrolü YOK, yalnızca giriş şartı var.
   */
  app.get('/developers/applications/:id', async (request, reply) => {
    userId(request);
    const id = snowflakeParam(request.params, 'id');
    const appRow = await db.query.botApplications.findFirst({ where: eq(botApplications.id, id) });
    if (!appRow) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');
    const botUser = await db.query.users.findFirst({ where: eq(users.id, appRow.botUserId) });
    if (!botUser) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');
    return reply.send(toAPIBotApplication(appRow, botUser));
  });

  app.patch('/developers/applications/:id', async (request, reply) => {
    const me = userId(request);
    const id = snowflakeParam(request.params, 'id');
    const appRow = await db.query.botApplications.findFirst({ where: eq(botApplications.id, id) });
    if (!appRow || appRow.ownerId !== me) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');

    const body = createAppBody.parse(request.body);
    await db.update(botApplications).set({ name: body.name }).where(eq(botApplications.id, id));
    await db.update(users).set({ displayName: body.name }).where(eq(users.id, appRow.botUserId));

    const updated = (await db.query.botApplications.findFirst({ where: eq(botApplications.id, id) }))!;
    const botUser = (await db.query.users.findFirst({ where: eq(users.id, appRow.botUserId) }))!;
    return reply.send(toAPIBotApplication(updated, botUser));
  });

  /** Token sızmışsa veya yeni token isteniyorsa — eskisi ANINDA geçersiz olur. */
  app.post('/developers/applications/:id/reset-token', async (request, reply) => {
    const me = userId(request);
    const id = snowflakeParam(request.params, 'id');
    const appRow = await db.query.botApplications.findFirst({ where: eq(botApplications.id, id) });
    if (!appRow || appRow.ownerId !== me) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');

    const token = generateBotToken();
    await db.update(botApplications).set({ tokenHash: hashToken(token) }).where(eq(botApplications.id, id));

    const botUser = (await db.query.users.findFirst({ where: eq(users.id, appRow.botUserId) }))!;
    return reply.send({ ...toAPIBotApplication(appRow, botUser), token });
  });

  app.delete('/developers/applications/:id', async (request, reply) => {
    const me = userId(request);
    const id = snowflakeParam(request.params, 'id');
    const appRow = await db.query.botApplications.findFirst({ where: eq(botApplications.id, id) });
    if (!appRow || appRow.ownerId !== me) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');

    const botUser = await db.query.users.findFirst({ where: eq(users.id, appRow.botUserId) });

    // Bulunduğu her sunucudan çıkar, diğer üyelere haber ver (kick akışıyla aynı).
    const memberships = await db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, appRow.botUserId));
    for (const { guildId } of memberships) {
      await db
        .delete(guildMembers)
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, appRow.botUserId)));
      await db
        .delete(memberRoles)
        .where(and(eq(memberRoles.guildId, guildId), eq(memberRoles.userId, appRow.botUserId)));
      if (botUser) {
        await publishToGuild({
          guildId: guildId.toString(),
          event: GatewayEvent.GUILD_MEMBER_REMOVE,
          payload: { guildId: guildId.toString(), user: toPublicUser(botUser) },
        });
      }
    }

    // Uygulama kaydı silinir (owner'ın listesinden düşer); bot kullanıcısı
    // KVKK deseniyle aynı şekilde anonimleştirilir — mesajları silinmez
    // (5651: içerik geçmişi başkalarının sohbetinde kalmaya devam eder).
    await db.delete(botApplications).where(eq(botApplications.id, id));
    await db
      .update(users)
      .set({ deletedAt: new Date(), isDisabled: true })
      .where(eq(users.id, appRow.botUserId));

    return reply.status(204).send();
  });

  /* ---------------- Sunucuya bot ekleme (yetkilendirme) ---------------- */

  app.post('/guilds/:guildId/bots', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    const access = await requireGuildAccess(guildId, me);
    assertPermission(access.permissions, Permission.MANAGE_GUILD);

    const body = addBotBody.parse(request.body);
    const applicationId = BigInt(body.applicationId);
    const requested = BigInt(body.permissions);

    const appRow = await db.query.botApplications.findFirst({
      where: eq(botApplications.id, applicationId),
    });
    if (!appRow) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');
    const botUser = await db.query.users.findFirst({ where: eq(users.id, appRow.botUserId) });
    if (!botUser) throw Errors.notFound('unknown_application', 'Uygulama bulunamadı');

    // Sahip olmadığın izni bota veremezsin — rol oluşturmadaki kuralla aynı.
    const own = computeBasePermissions(access.guild, access.member);
    if ((requested & ~own) !== 0n) {
      throw Errors.forbidden('cannot_grant_permissions', 'Sahip olmadığın izinleri veremezsin');
    }

    const banned = await db.query.bans.findFirst({
      where: and(eq(bans.guildId, guildId), eq(bans.userId, appRow.botUserId)),
    });
    if (banned) throw Errors.forbidden('banned', 'Bu bot bu sunucudan yasaklı');

    const existing = await db.query.guildMembers.findFirst({
      where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, appRow.botUserId)),
    });
    if (existing) throw Errors.conflict('bot_already_added', 'Bu bot zaten bu sunucuda');

    await db.insert(guildMembers).values({ guildId, userId: appRow.botUserId });

    // Bot için, izin isteğini taşıyan kendi rolü — sunucu adminin en yüksek
    // rolünün ALTINA (rol oluşturma uçlarındaki kuralla birebir aynı).
    const highest = Math.max(
      0,
      ...access.member.roleIds.map((rid) => access.guild.roles.get(rid)?.position ?? 0),
    );
    const position = access.guild.ownerId === me.toString() ? highest + 1 : Math.max(1, highest);

    const roleId = nextId();
    const [role] = await db
      .insert(roles)
      .values({
        id: roleId,
        guildId,
        name: appRow.name.slice(0, Limits.ROLE_NAME_MAX),
        permissions: requested,
        position,
      })
      .returning();

    await db.insert(memberRoles).values({ guildId, userId: appRow.botUserId, roleId });

    const membership = await db.query.guildMembers.findFirst({
      where: and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, appRow.botUserId)),
    });

    await writeAuditLog({
      guildId,
      actorId: me,
      actionType: 'bot_add',
      targetId: appRow.botUserId,
      changes: { name: { before: null, after: appRow.name } },
    });

    const memberPayload = toAPIMember(membership!, botUser, [roleId]);
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_MEMBER_ADD,
      payload: memberPayload,
    });
    await publishToGuild({
      guildId: guildId.toString(),
      event: GatewayEvent.GUILD_ROLE_CREATE,
      payload: toAPIRole(role!),
    });
    await refreshChannelVisibility(guildId, [appRow.botUserId]);

    return reply.status(201).send({ member: memberPayload, role: toAPIRole(role!) });
  });
}
