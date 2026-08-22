/**
 * Platform yönetici uçları — yalnızca is_admin=true kullanıcılar.
 *
 * Bunlar sunucu moderatörlüğünden AYRI: platform sahibinin tüm sistemi
 * görebilmesi için. Her uç önce isAdmin kontrol eder; değilse 404 döner
 * (403 değil — admin uçlarının varlığı sıradan kullanıcıya sızmasın).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gte, isNotNull, isNull, ne, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { GatewayEvent } from '@tuscord/shared';
import { db } from '../db/index.js';
import {
  activeUserPeaks,
  attachments,
  desktopDownloads,
  guildMembers,
  guilds,
  memberRoles,
  messages,
  roles,
  trafficLogs,
  users,
} from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { userId } from '../app.js';
import { snowflakeParam } from '../lib/validate.js';
import { forceLogoutUser } from '../auth/session.js';
import { deleteGuildAttachmentFiles } from '../services/guildCleanup.js';
import { joinGuildById } from '../services/joinGuild.js';
import { publishToGuild, publishToUsers } from '../services/events.js';
import { toAPIGuild, toAPIMember, toAPIRole, toPublicUser } from '../services/serialize.js';
import { onlineUserCount } from '../services/onlineUsers.js';
import { getActiveUserStats } from '../services/activeUserPeaks.js';

export function assertAdmin(request: FastifyRequest): void {
  if (!request.session?.user.isAdmin) throw Errors.notFound();
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** Platform geneli özet — admin panelindeki "Genel bakış" sekmesi. */
  app.get('/admin/summary', async (request, reply) => {
    assertAdmin(request);

    const [[userCountRow], [guildCountRow], [downloadCountRow], activeStats] = await Promise.all([
      db.select({ value: count() }).from(users).where(isNull(users.deletedAt)),
      db.select({ value: count() }).from(guilds),
      db.select({ value: count() }).from(desktopDownloads),
      getActiveUserStats(),
    ]);

    return reply.send({
      totalUsers: userCountRow?.value ?? 0,
      totalGuilds: guildCountRow?.value ?? 0,
      totalDesktopDownloads: downloadCountRow?.value ?? 0,
      activeUsersNow: onlineUserCount(),
      dailyPeakActiveUsers: activeStats.dailyPeak,
      allTimePeakActiveUsers: activeStats.allTimePeak,
    });
  });

  /**
   * Günlük seri: benzersiz aktif kullanıcı, yeni kayıt, en yüksek eşzamanlı
   * kullanıcı — geçici raporlama sayfası için (bkz. web AdminStats.tsx).
   * Üç ayrı GROUP BY sorgusu sonra JS'te tarihe göre birleştirme: tek
   * sorguda JOIN etmek (users × traffic_logs × active_user_peaks) satır
   * çarpımına yol açardı — guilds/admin.ts'teki aynı desen (bkz. yukarısı).
   */
  app.get('/admin/stats/daily', async (request, reply) => {
    assertAdmin(request);
    const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (query.days - 1));
    since.setUTCHours(0, 0, 0, 0);
    const sinceDay = since.toISOString().slice(0, 10);

    const [registrationRows, uniqueUserRows, peakRows, downloadRows] = await Promise.all([
      db
        .select({ day: sql<string>`date_trunc('day', ${users.createdAt})::date`, value: count() })
        .from(users)
        .where(gte(users.createdAt, since))
        .groupBy(sql`1`),
      db
        .select({
          day: sql<string>`date_trunc('day', ${trafficLogs.createdAt})::date`,
          value: sql<number>`count(distinct ${trafficLogs.userId})`,
        })
        .from(trafficLogs)
        .where(
          and(
            gte(trafficLogs.createdAt, since),
            isNotNull(trafficLogs.userId),
            ne(trafficLogs.eventType, 'login_failed'),
          ),
        )
        .groupBy(sql`1`),
      db
        .select({ day: activeUserPeaks.day, value: activeUserPeaks.peak })
        .from(activeUserPeaks)
        .where(gte(activeUserPeaks.day, sinceDay)),
      db
        .select({ day: sql<string>`date_trunc('day', ${desktopDownloads.createdAt})::date`, value: count() })
        .from(desktopDownloads)
        .where(gte(desktopDownloads.createdAt, since))
        .groupBy(sql`1`),
    ]);

    const toMap = (rows: { day: string; value: number | string }[]) =>
      new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.value)]));
    const registrations = toMap(registrationRows);
    const uniqueUsers = toMap(uniqueUserRows);
    const peaks = toMap(peakRows);
    const downloads = toMap(downloadRows);

    // Veri olmayan günler de 0 ile serimizde yer alsın — çizgi grafik
    // aralarında atlama yapmasın (bkz. AdminStats.tsx).
    const series: {
      date: string;
      uniqueUsers: number;
      newRegistrations: number;
      peakConcurrent: number;
      desktopDownloads: number;
    }[] = [];
    for (let i = 0; i < query.days; i++) {
      const day = new Date(since);
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      series.push({
        date: key,
        uniqueUsers: uniqueUsers.get(key) ?? 0,
        newRegistrations: registrations.get(key) ?? 0,
        peakConcurrent: peaks.get(key) ?? 0,
        desktopDownloads: downloads.get(key) ?? 0,
      });
    }

    return reply.send(series);
  });

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

  /**
   * Tüm sunucular + üye sayısı + disk kullanımı.
   *
   * Üye sayısı ve disk kullanımı AYRI sorgularla hesaplanıyor: tek sorguda
   * guildMembers VE messages/attachments'ı birlikte JOIN etmek satır
   * çarpımına (fan-out) yol açar — bir sunucunun hem 50 üyesi hem 30 eki
   * varsa JOIN 1500 satır üretir, COUNT/SUM'lar yanlış şişer. İki ayrı
   * GROUP BY sorgusu, sonra guild id'sine göre JS'te birleştirme.
   */
  app.get('/admin/guilds', async (request, reply) => {
    assertAdmin(request);

    const memberCounts = await db
      .select({ guildId: guildMembers.guildId, count: count(guildMembers.userId) })
      .from(guildMembers)
      .groupBy(guildMembers.guildId);
    const memberCountByGuild = new Map(memberCounts.map((r) => [r.guildId.toString(), Number(r.count)]));

    // messages.guildId denormalize edilmiş — channels üzerinden JOIN gerekmiyor.
    const storageSums = await db
      .select({ guildId: messages.guildId, bytes: sum(attachments.size) })
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId))
      .where(eq(attachments.scanStatus, 'clean'))
      .groupBy(messages.guildId);
    const storageByGuild = new Map(
      storageSums
        .filter((r) => r.guildId !== null)
        .map((r) => [r.guildId!.toString(), Number(r.bytes ?? 0)]),
    );

    const rows = await db.select().from(guilds).orderBy(desc(guilds.createdAt)).limit(200);

    return reply.send(
      rows.map((guild) => ({
        ...toAPIGuild(guild),
        memberCount: memberCountByGuild.get(guild.id.toString()) ?? 0,
        storageBytes: storageByGuild.get(guild.id.toString()) ?? 0,
      })),
    );
  });

  /** Bir sunucunun tüm üyeleri + rolleri (admin, üyesi olmadan görebilir). */
  app.get('/admin/guilds/:guildId/members', async (request, reply) => {
    assertAdmin(request);
    const guildId = snowflakeParam(request.params, 'guildId');

    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) throw Errors.notFound();

    const roleRows = await db.select().from(roles).where(eq(roles.guildId, guildId));

    const memberRows = await db
      .select()
      .from(guildMembers)
      .innerJoin(users, eq(users.id, guildMembers.userId))
      .where(eq(guildMembers.guildId, guildId));

    const roleAssignments = await db.select().from(memberRoles).where(eq(memberRoles.guildId, guildId));
    const rolesByUser = new Map<string, bigint[]>();
    for (const row of roleAssignments) {
      const key = row.userId.toString();
      rolesByUser.set(key, [...(rolesByUser.get(key) ?? []), row.roleId]);
    }

    return reply.send({
      roles: roleRows.map(toAPIRole),
      members: memberRows.map((row) =>
        toAPIMember(row.guild_members, row.users, rolesByUser.get(row.users.id.toString()) ?? []),
      ),
    });
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

  /**
   * Herhangi bir sunucuyu sil — normal `/guilds/:id` ucunun aksine (bkz.
   * guilds.ts: "ADMINISTRATOR bile sunucuyu silemez") admin BUNU bilerek
   * baypas eder; platform yöneticisinin taşan/kötüye kullanılan bir
   * sunucuyu sahibinden bağımsız kaldırabilmesi gerekiyor.
   */
  app.delete('/admin/guilds/:guildId', async (request, reply) => {
    assertAdmin(request);
    const guildId = snowflakeParam(request.params, 'guildId');

    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) throw Errors.notFound();

    const members = await db
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(eq(guildMembers.guildId, guildId));

    // Asıl dosyalar guild satırı silinmeden ÖNCE — CASCADE attachments
    // satırlarını da götürüyor, o zaman objectKey'lere erişilemez.
    await deleteGuildAttachmentFiles(guildId);
    await db.delete(guilds).where(eq(guilds.id, guildId));

    await publishToUsers(
      members.map((m) => m.userId.toString()),
      { event: GatewayEvent.GUILD_DELETE, payload: { id: guildId.toString(), removed: false } },
    );
    return reply.status(204).send();
  });

  /**
   * Bir kullanıcıyı platformda yasakla/yasağı kaldır — `isDisabled` giriş
   * yapmasını engeller (bkz. auth.ts login: isDisabled kontrolü), veri
   * SİLİNMEZ (silme AYRI bir uç, aşağıda). Geri alınabilir — geçici önlem.
   */
  app.patch('/admin/users/:targetUserId/ban', async (request, reply) => {
    assertAdmin(request);
    const me = userId(request);
    const targetUserId = snowflakeParam(request.params, 'targetUserId');
    const body = z.object({ banned: z.boolean() }).parse(request.body);

    const target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
    if (!target) throw Errors.notFound();
    if (targetUserId === me) throw Errors.badRequest('cannot_target_self', 'Kendini yasaklayamazsın');
    if (target.isAdmin) throw Errors.badRequest('cannot_target_admin', 'Önce yönetici yetkisini kaldır');

    await db.update(users).set({ isDisabled: body.banned }).where(eq(users.id, targetUserId));
    // Yalnızca oturum satırlarını silmek yetmez — hâlâ gateway'e bağlıysa
    // sayfayı yenileyene kadar bağlı kalıp mesaj yazmaya devam edebilir
    // (bkz. kullanıcı raporu). FORCE_LOGOUT ile anında koparılır.
    if (body.banned) await forceLogoutUser(targetUserId, 'account_banned');

    return reply.status(204).send();
  });

  /**
   * Bir kullanıcıyı kalıcı olarak sil — self-delete (`/users/@me/delete`)
   * ile AYNI anonimleştirme deseni, ama sahip olduğu sunucuları önce
   * TEK TEK silmesini beklemez: admin yetkisi bunları da onun yerine siler.
   */
  app.post('/admin/users/:targetUserId/delete', async (request, reply) => {
    assertAdmin(request);
    const me = userId(request);
    const targetUserId = snowflakeParam(request.params, 'targetUserId');

    const target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
    if (!target) throw Errors.notFound();
    if (targetUserId === me) throw Errors.badRequest('cannot_target_self', 'Kendini silemezsin');
    if (target.isAdmin) throw Errors.badRequest('cannot_target_admin', 'Önce yönetici yetkisini kaldır');

    const owned = await db.select({ id: guilds.id }).from(guilds).where(eq(guilds.ownerId, targetUserId));
    for (const g of owned) {
      const members = await db
        .select({ userId: guildMembers.userId })
        .from(guildMembers)
        .where(eq(guildMembers.guildId, g.id));
      await deleteGuildAttachmentFiles(g.id);
      await db.delete(guilds).where(eq(guilds.id, g.id));
      await publishToUsers(
        members.map((m) => m.userId.toString()),
        { event: GatewayEvent.GUILD_DELETE, payload: { id: g.id.toString(), removed: false } },
      );
    }

    // Sahip OLMADIĞI, yalnızca üyesi olduğu sunucular — anonimleştirmeden
    // ÖNCE topla, diğer üyelerin ekranı canlı güncellensin diye (bkz.
    // kullanıcı raporu: "sunucusundaki kullanıcılar sayfalarını restart
    // edene kadar görmeye devam ediyor"). Sahip olduğu sunucular yukarıda
    // zaten tamamen silindi, guild_members'ları da onunla gitti.
    const memberships = await db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, targetUserId));

    const [updated] = await db
      .update(users)
      .set({
        deletedAt: new Date(),
        isDisabled: true,
        username: `silinmis_${targetUserId.toString().slice(-8)}`,
        displayName: null,
        email: `deleted-${targetUserId}@invalid`,
        avatarUrl: null,
        bio: null,
        mfaSecret: null,
      })
      .where(eq(users.id, targetUserId))
      .returning();

    await db.delete(guildMembers).where(eq(guildMembers.userId, targetUserId));

    await Promise.all(
      memberships.map(({ guildId }) =>
        publishToGuild({
          guildId: guildId.toString(),
          event: GatewayEvent.GUILD_MEMBER_REMOVE,
          payload: { guildId: guildId.toString(), user: toPublicUser(updated!) },
        }),
      ),
    );

    await forceLogoutUser(targetUserId, 'account_deleted');

    return reply.status(204).send();
  });
}
