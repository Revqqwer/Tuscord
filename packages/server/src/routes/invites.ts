/**
 * Davet uçları.
 *
 * Katılma akışında raid koruması burada uygulanır: yeni hesap yaşı ve
 * doğrulanmış e-posta koşulları (spec Bölüm 8).
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { GatewayEvent, Permission } from '@tuscord/shared';
import { db } from '../db/index.js';
import { bans, guildMembers, guilds, invites, users } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { userId } from '../app.js';
import { assertPermission, requireChannelAccess, requireGuildAccess } from '../services/permissions.js';
import { publishToGuild, publishToUsers } from '../services/events.js';
import { buildReadyGuild } from '../services/readyGuild.js';
import { toAPIGuild, toAPIMember } from '../services/serialize.js';
import { writeAuditLog } from '../services/audit.js';
import { snowflakeParam } from '../lib/validate.js';

/** 8 karakterlik, tahmin edilmesi zor davet kodu. */
function generateCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  /** Davet önizlemesi — giriş yapmamış kullanıcı da görebilmeli. */
  app.get('/invites/:code', async (request, reply) => {
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(request.params);
    const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
    if (!invite) throw Errors.notFound('unknown_invite', 'Davet geçersiz');
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw Errors.notFound('unknown_invite', 'Davetin süresi dolmuş');
    }

    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, invite.guildId) });
    if (!guild) throw Errors.notFound('unknown_invite', 'Davet geçersiz');

    const memberCount = await db
      .select({ value: count() })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, invite.guildId));

    return reply.send({
      code: invite.code,
      guild: {
        id: guild.id.toString(),
        name: guild.name,
        iconUrl: guild.iconUrl,
        description: guild.description,
      },
      memberCount: memberCount[0]?.value ?? 0,
    });
  });

  app.register(async (authed) => {
    authed.addHook('preHandler', authed.requireAuth);

    authed.post('/channels/:channelId/invites', async (request, reply) => {
      const me = userId(request);
      const channelId = snowflakeParam(request.params, 'channelId');
      await app.rateLimiter.consume('INVITE_CREATE', me.toString());

      const access = await requireChannelAccess(channelId, me);
      assertPermission(access.permissions, Permission.CREATE_INVITE);

      const body = z
        .object({
          maxUses: z.number().int().min(0).max(1000).default(0),
          /** Saniye; 0 = süresiz. */
          maxAge: z.number().int().min(0).max(30 * 86_400).default(7 * 86_400),
        })
        .parse(request.body ?? {});

      const code = generateCode();
      await db.insert(invites).values({
        code,
        guildId: access.channel.guildId!,
        channelId,
        inviterId: me,
        maxUses: body.maxUses > 0 ? body.maxUses : null,
        expiresAt: body.maxAge > 0 ? new Date(Date.now() + body.maxAge * 1000) : null,
      });

      await writeAuditLog({
        guildId: access.channel.guildId!,
        actorId: me,
        actionType: 'invite_create',
        changes: { code: { before: null, after: code } },
      });

      return reply.status(201).send({ code });
    });

    authed.get('/guilds/:guildId/invites', async (request, reply) => {
      const me = userId(request);
      const guildId = snowflakeParam(request.params, 'guildId');
      const access = await requireGuildAccess(guildId, me);
      assertPermission(access.permissions, Permission.MANAGE_GUILD);

      const rows = await db.select().from(invites).where(eq(invites.guildId, guildId));
      return reply.send(
        rows.map((row) => ({
          code: row.code,
          guildId: row.guildId.toString(),
          channelId: row.channelId.toString(),
          inviterId: row.inviterId.toString(),
          uses: row.uses,
          maxUses: row.maxUses,
          expiresAt: row.expiresAt?.toISOString() ?? null,
        })),
      );
    });

    authed.delete('/invites/:code', async (request, reply) => {
      const me = userId(request);
      const { code } = z.object({ code: z.string().min(4).max(12) }).parse(request.params);
      const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
      if (!invite) throw Errors.notFound('unknown_invite', 'Davet bulunamadı');

      const access = await requireGuildAccess(invite.guildId, me);
      // Kendi davetini silmek için ek izin gerekmez.
      if (invite.inviterId !== me) {
        assertPermission(access.permissions, Permission.MANAGE_GUILD);
      }

      await db.delete(invites).where(eq(invites.code, code));
      await writeAuditLog({
        guildId: invite.guildId,
        actorId: me,
        actionType: 'invite_delete',
        changes: { code: { before: code, after: null } },
      });
      return reply.status(204).send();
    });

    /* ---------------- Katılma ---------------- */

    authed.post('/invites/:code/join', async (request, reply) => {
      const me = userId(request);
      const { code } = z.object({ code: z.string().min(4).max(12) }).parse(request.params);

      const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
      if (!invite) throw Errors.notFound('unknown_invite', 'Davet geçersiz');
      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        throw Errors.notFound('unknown_invite', 'Davetin süresi dolmuş');
      }
      if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
        throw Errors.notFound('unknown_invite', 'Davet kullanım sınırına ulaştı');
      }

      const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, invite.guildId) });
      if (!guild) throw Errors.notFound('unknown_invite', 'Davet geçersiz');

      const banned = await db.query.bans.findFirst({
        where: and(eq(bans.guildId, invite.guildId), eq(bans.userId, me)),
      });
      if (banned) throw Errors.forbidden('banned', 'Bu sunucudan yasaklandın');

      const existing = await db.query.guildMembers.findFirst({
        where: and(eq(guildMembers.guildId, invite.guildId), eq(guildMembers.userId, me)),
      });
      if (existing) return reply.send(toAPIGuild(guild));

      // Raid koruması (spec Bölüm 8): hesap yaşı ve e-posta doğrulaması.
      const user = await db.query.users.findFirst({ where: eq(users.id, me) });
      if (!user) throw Errors.unauthorized();
      if (guild.requireVerifiedEmail && !user.emailVerified) {
        throw Errors.forbidden('email_not_verified', 'Bu sunucu doğrulanmış e-posta istiyor');
      }
      if (guild.minAccountAgeHours > 0) {
        const ageHours = (Date.now() - user.createdAt.getTime()) / 3_600_000;
        if (ageHours < guild.minAccountAgeHours) {
          throw Errors.forbidden('account_too_new', 'Hesabın bu sunucuya katılmak için çok yeni');
        }
      }

      await db.transaction(async (tx) => {
        await tx.insert(guildMembers).values({ guildId: invite.guildId, userId: me });
        await tx
          .update(invites)
          .set({ uses: invite.uses + 1 })
          .where(eq(invites.code, code));
      });

      const membership = await db.query.guildMembers.findFirst({
        where: and(eq(guildMembers.guildId, invite.guildId), eq(guildMembers.userId, me)),
      });

      // Mevcut üyelere yeni katılanı bildir.
      await publishToGuild({
        guildId: invite.guildId.toString(),
        event: GatewayEvent.GUILD_MEMBER_ADD,
        payload: toAPIMember(membership!, user, []),
      });

      // Katılana sunucunun kendisini gönder.
      //
      // Bunu sunucu kanalına yayınlamak YETMEZ: yeni üyenin bağlantısı o
      // kanala henüz abone değil ve kimse bağlı değilse olay hiç işlenmez.
      // Doğrudan kullanıcı kanalına göndermek, gateway'in bağlantıyı
      // sunucuya bağlamasını da tetikler.
      const ready = await buildReadyGuild(invite.guildId, me);
      if (ready) {
        await publishToUsers([me.toString()], {
          event: GatewayEvent.GUILD_CREATE,
          payload: ready,
        });
      }

      return reply.send(toAPIGuild(guild));
    });
  });
}
