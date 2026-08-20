/**
 * Kullanıcı uçları: profil, DM kanalları, okundu bilgisi, KVKK hakları.
 */

import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ChannelType, GatewayEvent, Limits } from '@tuscord/shared';
import { db } from '../db/index.js';
import {
  channelRecipients,
  channels,
  guildMembers,
  guilds,
  messages,
  readStates,
  users,
} from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId } from '../app.js';
import { forceLogoutUser } from '../auth/session.js';
import { loadPrivateChannels } from '../services/privateChannels.js';
import { publishToGuild, publishToUsers } from '../services/events.js';
import { toAPIChannel, toAPIGuild, toPublicUser, toSelfUser } from '../services/serialize.js';
import { detectFileType } from '../services/fileType.js';
import { generateObjectKey, storage } from '../services/storage.js';
import { snowflakeParam } from '../lib/validate.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.patch('/users/@me', async (request, reply) => {
    const me = userId(request);
    const body = z
      .object({
        displayName: z.string().trim().max(Limits.DISPLAY_NAME_MAX).nullable().optional(),
        bio: z.string().trim().max(Limits.BIO_MAX).nullable().optional(),
        avatarUrl: z.string().url().nullable().optional(),
        locale: z.enum(['tr', 'en']).optional(),
      })
      .parse(request.body);

    const patch: Record<string, unknown> = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl;
    if (body.locale !== undefined) patch.locale = body.locale;

    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, me));
    }

    const updated = await db.query.users.findFirst({ where: eq(users.id, me) });
    return reply.send(
      toSelfUser({
        id: updated!.id,
        username: updated!.username,
        discriminator: updated!.discriminator,
        displayName: updated!.displayName,
        email: updated!.email,
        emailVerified: updated!.emailVerified,
        avatarUrl: updated!.avatarUrl,
        bio: updated!.bio,
        locale: updated!.locale,
        isBot: updated!.isBot,
        mfaEnabled: updated!.mfaSecret !== null,
        isAdmin: updated!.isAdmin,
      }),
    );
  });

  /**
   * Avatar yükleme. Mesaj eklerinden ayrı bir uç: avatar bir kanala bağlı değil.
   * Yalnızca görsel kabul edilir (magic byte); depolama katmanı R2 ya da yerel disk.
   */
  app.post('/users/@me/avatar', async (request, reply) => {
    const me = userId(request);
    await app.rateLimiter.consume('ATTACHMENT_UPLOAD', me.toString());

    const file = await request.file({ limits: { fileSize: Limits.AVATAR_SIZE_MAX, files: 1 } });
    if (!file) throw Errors.badRequest('missing_file', 'Dosya gönderilmedi');

    const buffer = await file.toBuffer().catch(() => null);
    if (!buffer) throw Errors.tooLarge();
    if (file.file.truncated || buffer.byteLength > Limits.AVATAR_SIZE_MAX) {
      throw Errors.tooLarge(`Avatar en fazla ${Limits.AVATAR_SIZE_MAX / 1024 / 1024} MB olabilir`);
    }

    // İçeriğe bak, uzantıya değil — ve yalnızca görsel kabul et.
    const type = detectFileType(buffer);
    if (!type || type.kind !== 'image') {
      throw Errors.badRequest('unsupported_file_type', 'Avatar bir görsel olmalı');
    }

    const objectKey = generateObjectKey('avatars', type.extension);
    await storage.put(objectKey, buffer, type.mime);
    const avatarUrl = storage.publicUrl(objectKey);

    await db.update(users).set({ avatarUrl }).where(eq(users.id, me));
    return reply.send({ avatarUrl });
  });

  app.get('/users/:targetId', async (request, reply) => {
    const targetId = snowflakeParam(request.params, 'targetId');
    const user = await db.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!user || user.deletedAt) throw Errors.notFound('unknown_user', 'Kullanıcı bulunamadı');
    return reply.send(toPublicUser(user));
  });

  /** Kullanıcının üye olduğu sunucular. */
  app.get('/users/@me/guilds', async (request, reply) => {
    const me = userId(request);
    const rows = await db
      .select()
      .from(guildMembers)
      .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
      .where(eq(guildMembers.userId, me));
    return reply.send(rows.map((row) => toAPIGuild(row.guilds)));
  });

  /* ---------------- DM ---------------- */

  app.get('/users/@me/channels', async (request, reply) => {
    return reply.send(await loadPrivateChannels(userId(request)));
  });

  /** DM aç (varsa mevcut kanalı döner). Grup DM için birden fazla alıcı ver. */
  app.post('/users/@me/channels', async (request, reply) => {
    const me = userId(request);
    const body = z
      .object({
        recipientIds: z
          .array(z.string().regex(/^\d+$/))
          .min(1)
          .max(Limits.GROUP_DM_RECIPIENTS_MAX - 1),
      })
      .parse(request.body);

    const recipientIds = [...new Set(body.recipientIds.map(BigInt))].filter((id) => id !== me);
    if (recipientIds.length === 0) {
      throw Errors.badRequest('invalid_recipients', 'Kendinle DM açamazsın');
    }

    const found = await db.select().from(users).where(inArray(users.id, recipientIds));
    if (found.length !== recipientIds.length) {
      throw Errors.notFound('unknown_user', 'Kullanıcı bulunamadı');
    }

    const participants = [me, ...recipientIds];
    const isGroup = recipientIds.length > 1;

    // İkili DM'de mevcut kanalı yeniden kullan — her mesajda yeni kanal açmak
    // sohbeti parçalar.
    if (!isGroup) {
      const existing = await db
        .select({ channelId: channelRecipients.channelId })
        .from(channelRecipients)
        .innerJoin(channels, eq(channels.id, channelRecipients.channelId))
        .where(and(eq(channels.type, ChannelType.DM), inArray(channelRecipients.userId, participants)))
        .groupBy(channelRecipients.channelId)
        .having(sql`count(*) = 2`);

      const first = existing[0];
      if (first) {
        await db
          .update(channelRecipients)
          .set({ closed: false })
          .where(
            and(
              eq(channelRecipients.channelId, first.channelId),
              eq(channelRecipients.userId, me),
            ),
          );
        const channel = await db.query.channels.findFirst({
          where: eq(channels.id, first.channelId),
        });
        return reply.send(await serializeDM(channel!, me));
      }
    }

    const channelId = nextId();
    await db.transaction(async (tx) => {
      await tx.insert(channels).values({
        id: channelId,
        guildId: null,
        type: isGroup ? ChannelType.GROUP_DM : ChannelType.DM,
        name: null,
        ownerId: isGroup ? me : null,
      });
      await tx
        .insert(channelRecipients)
        .values(participants.map((participantId) => ({ channelId, userId: participantId })));
    });

    const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });

    // Karşı tarafa da haber ver: DM listesinde anında belirsin, ilk mesajı
    // beklemesin. Herkes kendi bakış açısıyla serileştirilmiş kanalı alır.
    for (const participantId of recipientIds) {
      const forThem = await serializeDM(channel!, participantId);
      await publishToUsers([participantId.toString()], {
        event: GatewayEvent.CHANNEL_CREATE,
        payload: forThem,
      });
    }

    return reply.status(201).send(await serializeDM(channel!, me));
  });

  /* ---------------- Okundu bilgisi ---------------- */

  app.post('/channels/:channelId/ack', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const body = z.object({ messageId: z.string().regex(/^\d+$/) }).parse(request.body);

    await db
      .insert(readStates)
      .values({
        userId: me,
        channelId,
        lastReadMessageId: BigInt(body.messageId),
        mentionCount: 0,
      })
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.channelId],
        set: { lastReadMessageId: BigInt(body.messageId), mentionCount: 0 },
      });

    return reply.status(204).send();
  });

  /* ---------------- KVKK ---------------- */

  /**
   * Veri taşınabilirliği: kullanıcının kendi verisinin dışa aktarımı.
   * KVKK m.11 kapsamındaki "işlenen verileri öğrenme" hakkının karşılığı.
   */
  app.get('/users/@me/data-export', async (request, reply) => {
    const me = userId(request);
    const user = await db.query.users.findFirst({ where: eq(users.id, me) });
    const myMessages = await db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.authorId, me))
      .limit(10_000);

    const myGuilds = await db
      .select({ guildId: guildMembers.guildId, joinedAt: guildMembers.joinedAt })
      .from(guildMembers)
      .where(eq(guildMembers.userId, me));

    return reply.send({
      user: {
        id: user!.id.toString(),
        username: user!.username,
        discriminator: user!.discriminator,
        email: user!.email,
        createdAt: user!.createdAt.toISOString(),
      },
      guilds: myGuilds.map((g) => ({
        guildId: g.guildId.toString(),
        joinedAt: g.joinedAt.toISOString(),
      })),
      messages: myMessages.map((m) => ({
        id: m.id.toString(),
        channelId: m.channelId.toString(),
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  /**
   * Hesap silme talebi (KVKK m.7).
   *
   * Kullanıcı kaydı anonimleştirilir, mesajlar SİLİNMEZ: 5651 kapsamında
   * içeriğin ve trafik bilgisinin saklanması gerekiyor ve başkalarının
   * sohbet geçmişini delik deşik etmek de doğru değil. Mesajlar
   * "silinmiş-kullanıcı" olarak görünür.
   */
  app.post('/users/@me/delete', async (request, reply) => {
    const me = userId(request);
    const owned = await db.select({ id: guilds.id }).from(guilds).where(eq(guilds.ownerId, me));
    if (owned.length > 0) {
      throw Errors.badRequest(
        'owns_guilds',
        'Önce sahibi olduğun sunucuları sil veya devret',
      );
    }

    // Üye olduğum sunucuları anonimleştirmeden ÖNCE topla — diğer üyelerin
    // ekranı canlı güncellensin diye (bkz. kullanıcı raporu: "sunucusundaki
    // kullanıcılar sayfalarını restart edene kadar görmeye devam ediyor").
    const memberships = await db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, me));

    const [updated] = await db
      .update(users)
      .set({
        deletedAt: new Date(),
        isDisabled: true,
        username: `silinmis_${me.toString().slice(-8)}`,
        displayName: null,
        email: `deleted-${me}@invalid`,
        avatarUrl: null,
        bio: null,
        mfaSecret: null,
      })
      .where(eq(users.id, me))
      .returning();

    await db.delete(guildMembers).where(eq(guildMembers.userId, me));

    await Promise.all(
      memberships.map(({ guildId }) =>
        publishToGuild({
          guildId: guildId.toString(),
          event: GatewayEvent.GUILD_MEMBER_REMOVE,
          payload: { guildId: guildId.toString(), user: toPublicUser(updated!) },
        }),
      ),
    );

    // Kendi kendini sildiği için istemcisi zaten cevaptan sonra çıkış yapar
    // (bkz. UserSettings.tsx) — yine de gateway'e bağlıysa anında koparalım.
    await forceLogoutUser(me, 'account_deleted');

    return reply.status(204).send();
  });
}

async function serializeDM(channel: typeof channels.$inferSelect, viewerId: bigint) {
  const recipients = await db
    .select()
    .from(channelRecipients)
    .innerJoin(users, eq(users.id, channelRecipients.userId))
    .where(eq(channelRecipients.channelId, channel.id));

  return toAPIChannel(channel, {
    recipients: recipients
      .filter((row) => row.users.id !== viewerId)
      .map((row) => toPublicUser(row.users)),
  });
}
