/**
 * Mesaj uçları.
 *
 * Sayfalama HER ZAMAN snowflake kürsörü ile (before/after/around) —
 * OFFSET kullanmak, aktif bir kanalda kullanıcıya mesaj atlatır/tekrarlatır.
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  GatewayEvent,
  Limits,
  MessageType,
  Permission,
  has,
} from '@tuscord/shared';
import { db } from '../db/index.js';
import {
  attachments,
  channels,
  guilds,
  messages,
  reactions,
  readStates,
  users,
} from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId } from '../app.js';
import { checkSlowmode } from '../lib/ratelimit.js';
import { redis } from '../redis.js';
import { assertCanSend, requireMessageChannel } from '../services/channelAccess.js';
import { requireGuildAccess, visibleChannels } from '../services/permissions.js';
import { parseMentions, violatesWordFilter } from '../services/mentions.js';
import { publishChannelEvent } from '../services/events.js';
import { toAPIMessage } from '../services/serialize.js';
import { writeAuditLog } from '../services/audit.js';
import { optionalSnowflake, snowflakeParam } from '../lib/validate.js';
import type { Message, User } from '../db/schema.js';

const createMessageBody = z.object({
  content: z.string().max(Limits.MESSAGE_MAX).default(''),
  replyToId: z.string().optional(),
  attachmentIds: z.array(z.string()).max(Limits.ATTACHMENTS_PER_MESSAGE).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(Limits.MESSAGE_FETCH_LIMIT).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
  around: z.string().optional(),
});

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ---------------- Listeleme ---------------- */

  app.get('/channels/:channelId/messages', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.READ_MESSAGE_HISTORY)) throw Errors.forbidden();

    const query = listQuery.parse(request.query);
    const before = optionalSnowflake(query.before);
    const after = optionalSnowflake(query.after);
    const around = optionalSnowflake(query.around);

    let rows: Message[];
    if (around !== undefined) {
      // around: kürsörün iki yanından yarımşar sayfa. Bağlantıya tıklayıp
      // eski bir mesaja atlarken kullanılır.
      const half = Math.floor(query.limit / 2);
      const older = await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.channelId, channelId), isNull(messages.deletedAt), lt(messages.id, around)),
        )
        .orderBy(desc(messages.id))
        .limit(half);
      const newer = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            isNull(messages.deletedAt),
            gte(messages.id, around),
          ),
        )
        .orderBy(asc(messages.id))
        .limit(query.limit - half);
      rows = [...newer.reverse(), ...older];
    } else if (after !== undefined) {
      const asc_rows = await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.channelId, channelId), isNull(messages.deletedAt), gt(messages.id, after)),
        )
        .orderBy(asc(messages.id))
        .limit(query.limit);
      rows = asc_rows.reverse();
    } else {
      rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            isNull(messages.deletedAt),
            ...(before !== undefined ? [lt(messages.id, before)] : []),
          ),
        )
        .orderBy(desc(messages.id))
        .limit(query.limit);
    }

    return reply.send(await hydrate(rows, me));
  });

  /* ---------------- Gönderme ---------------- */

  app.post('/channels/:channelId/messages', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireMessageChannel(channelId, me);
    assertCanSend(access);

    await app.rateLimiter.consume('MESSAGE_CREATE', `${me}:${channelId}`);

    const body = createMessageBody.parse(request.body);
    const content = body.content.trim();
    const attachmentIds = (body.attachmentIds ?? []).map(BigInt);

    if (content.length === 0 && attachmentIds.length === 0) {
      throw Errors.badRequest('empty_message', 'Boş mesaj gönderilemez');
    }
    if (content.length > 0 && !has(access.permissions, Permission.SEND_MESSAGES)) {
      throw Errors.forbidden();
    }
    if (attachmentIds.length > 0 && !has(access.permissions, Permission.ATTACH_FILES)) {
      throw Errors.forbidden('missing_attach_files', 'Dosya ekleme iznin yok');
    }

    // Yavaş mod: MANAGE_MESSAGES olanlar muaf (Discord davranışı).
    if (!has(access.permissions, Permission.MANAGE_MESSAGES)) {
      await checkSlowmode(redis, channelId.toString(), me.toString(), access.channel.slowmodeSeconds);
    }

    // Kelime filtresi — sunucu ayarı.
    if (access.guildId) {
      const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, access.guildId) });
      const hit = violatesWordFilter(content, guild?.wordFilter ?? []);
      if (hit) throw Errors.badRequest('word_filter', 'Mesaj sunucu kelime filtresine takıldı');
    }

    let replyToId: bigint | null = null;
    if (body.replyToId) {
      replyToId = BigInt(body.replyToId);
      const target = await db.query.messages.findFirst({ where: eq(messages.id, replyToId) });
      if (!target || target.channelId !== channelId) {
        throw Errors.badRequest('unknown_reply', 'Yanıtlanan mesaj bulunamadı');
      }
    }

    const mentions = parseMentions(content, has(access.permissions, Permission.MENTION_EVERYONE));
    const messageId = nextId();

    const [created] = await db
      .insert(messages)
      .values({
        id: messageId,
        channelId,
        guildId: access.guildId,
        authorId: me,
        content,
        type: replyToId ? MessageType.REPLY : MessageType.DEFAULT,
        replyToId,
        mentions: mentions.users,
        mentionRoles: mentions.roles,
        mentionEveryone: mentions.everyone,
      })
      .returning();

    // Ekleri bu mesaja bağla — yalnızca yükleyen kendi eklerini bağlayabilir.
    if (attachmentIds.length > 0) {
      await db
        .update(attachments)
        .set({ messageId })
        .where(
          and(
            inArray(attachments.id, attachmentIds),
            eq(attachments.uploaderId, me),
            isNull(attachments.messageId),
          ),
        );
    }

    await db.update(channels).set({ lastMessageId: messageId }).where(eq(channels.id, channelId));

    // Bahsedilenlerin okunmamış bahsetme sayacını artır.
    // @everyone burada sayaç artırmaz: kanaldaki herkes için satır açmak
    // bu ölçekte bile gereksiz yazma yükü, kanal zaten okunmamış görünüyor.
    if (mentions.users.length > 0) {
      const mentioned = mentions.users
        .filter((id) => id !== me.toString())
        .map((id) => BigInt(id));
      for (const mentionedId of mentioned) {
        await db
          .insert(readStates)
          .values({ userId: mentionedId, channelId, lastReadMessageId: null, mentionCount: 1 })
          .onConflictDoUpdate({
            target: [readStates.userId, readStates.channelId],
            set: { mentionCount: sql`${readStates.mentionCount} + 1` },
          });
      }
    }

    const [payload] = await hydrate([created!], me);
    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_CREATE,
        payload,
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );

    return reply.status(201).send(payload);
  });

  /* ---------------- Düzenleme ---------------- */

  app.patch('/channels/:channelId/messages/:messageId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const access = await requireMessageChannel(channelId, me);
    await app.rateLimiter.consume('MESSAGE_EDIT', me.toString());

    const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
    if (!message || message.channelId !== channelId || message.deletedAt) {
      throw Errors.notFound('unknown_message', 'Mesaj bulunamadı');
    }
    // Düzenleme yalnızca yazara ait — MANAGE_MESSAGES başkasının sözünü
    // değiştirme yetkisi vermez, yalnızca silme yetkisi verir.
    if (message.authorId !== me) throw Errors.forbidden('not_author', 'Yalnızca kendi mesajını düzenleyebilirsin');

    const body = z.object({ content: z.string().max(Limits.MESSAGE_MAX) }).parse(request.body);
    const content = body.content.trim();
    if (content.length === 0) throw Errors.badRequest('empty_message', 'Boş mesaj olamaz');

    const mentions = parseMentions(content, has(access.permissions, Permission.MENTION_EVERYONE));
    const [updated] = await db
      .update(messages)
      .set({
        content,
        editedAt: new Date(),
        mentions: mentions.users,
        mentionRoles: mentions.roles,
        mentionEveryone: mentions.everyone,
      })
      .where(eq(messages.id, messageId))
      .returning();

    const [payload] = await hydrate([updated!], me);
    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_UPDATE,
        payload,
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.send(payload);
  });

  /* ---------------- Silme ---------------- */

  app.delete('/channels/:channelId/messages/:messageId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const access = await requireMessageChannel(channelId, me);

    const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
    if (!message || message.channelId !== channelId || message.deletedAt) {
      throw Errors.notFound('unknown_message', 'Mesaj bulunamadı');
    }

    const isAuthor = message.authorId === me;
    if (!isAuthor && !has(access.permissions, Permission.MANAGE_MESSAGES)) {
      throw Errors.forbidden();
    }

    // Yumuşak silme: içerik istemciden kalkar ama kayıt durur.
    // Bir kaldırma talebi veya raporun incelenmesi sırasında "ne silindi"
    // sorusuna cevap verebilmek gerekiyor (spec Bölüm 8).
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));

    if (!isAuthor && access.guildId) {
      await writeAuditLog({
        guildId: access.guildId,
        actorId: me,
        actionType: 'message_delete',
        targetId: message.authorId,
        changes: { messageId: { before: messageId.toString(), after: null } },
      });
    }

    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_DELETE,
        payload: {
          id: messageId.toString(),
          channelId: channelId.toString(),
          guildId: access.guildId?.toString() ?? null,
        },
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.status(204).send();
  });

  /** Toplu silme — moderasyon: bir kullanıcının son N mesajı. */
  app.post('/channels/:channelId/messages/bulk-delete', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.MANAGE_MESSAGES)) throw Errors.forbidden();

    const body = z
      .object({
        messageIds: z.array(z.string()).min(1).max(Limits.MESSAGE_BULK_DELETE_MAX).optional(),
        /** Ya da: bu kullanıcının son N mesajı. */
        authorId: z.string().optional(),
        limit: z.number().int().min(1).max(Limits.MESSAGE_BULK_DELETE_MAX).default(50),
      })
      .parse(request.body);

    let targets: bigint[];
    if (body.messageIds) {
      targets = body.messageIds.map(BigInt);
    } else if (body.authorId) {
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.channelId, channelId),
            eq(messages.authorId, BigInt(body.authorId)),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(desc(messages.id))
        .limit(body.limit);
      targets = rows.map((r) => r.id);
    } else {
      throw Errors.badRequest('missing_target', 'messageIds veya authorId gerekli');
    }

    if (targets.length === 0) return reply.status(204).send();

    await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.channelId, channelId), inArray(messages.id, targets)));

    if (access.guildId) {
      await writeAuditLog({
        guildId: access.guildId,
        actorId: me,
        actionType: 'message_bulk_delete',
        targetId: body.authorId ? BigInt(body.authorId) : null,
        changes: { count: { before: targets.length, after: 0 } },
      });
    }

    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_BULK_DELETE,
        payload: {
          ids: targets.map((t) => t.toString()),
          channelId: channelId.toString(),
          guildId: access.guildId?.toString() ?? null,
        },
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.status(204).send();
  });

  /* ---------------- Sabitleme ---------------- */

  app.put('/channels/:channelId/pins/:messageId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.MANAGE_MESSAGES)) throw Errors.forbidden();

    await db
      .update(messages)
      .set({ pinned: true })
      .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)));
    return reply.status(204).send();
  });

  app.delete('/channels/:channelId/pins/:messageId', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.MANAGE_MESSAGES)) throw Errors.forbidden();

    await db
      .update(messages)
      .set({ pinned: false })
      .where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)));
    return reply.status(204).send();
  });

  app.get('/channels/:channelId/pins', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.READ_MESSAGE_HISTORY)) throw Errors.forbidden();

    const rows = await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.channelId, channelId), eq(messages.pinned, true), isNull(messages.deletedAt)),
      )
      .orderBy(desc(messages.id))
      .limit(50);
    return reply.send(await hydrate(rows, me));
  });

  /* ---------------- Tepkiler ---------------- */

  app.put('/channels/:channelId/messages/:messageId/reactions/:emoji', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const emoji = decodeURIComponent((request.params as Record<string, string>).emoji ?? '');
    if (!emoji || emoji.length > 64) throw Errors.badRequest('invalid_emoji', 'Geçersiz emoji');

    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.ADD_REACTIONS)) throw Errors.forbidden();
    await app.rateLimiter.consume('REACTION_ADD', me.toString());

    const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
    if (!message || message.channelId !== channelId || message.deletedAt) {
      throw Errors.notFound('unknown_message', 'Mesaj bulunamadı');
    }

    await db.insert(reactions).values({ messageId, userId: me, emoji }).onConflictDoNothing();

    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_REACTION_ADD,
        payload: {
          messageId: messageId.toString(),
          channelId: channelId.toString(),
          guildId: access.guildId?.toString() ?? null,
          userId: me.toString(),
          emoji,
        },
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.status(204).send();
  });

  app.delete('/channels/:channelId/messages/:messageId/reactions/:emoji', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const messageId = snowflakeParam(request.params, 'messageId');
    const emoji = decodeURIComponent((request.params as Record<string, string>).emoji ?? '');
    const access = await requireMessageChannel(channelId, me);

    await db
      .delete(reactions)
      .where(
        and(
          eq(reactions.messageId, messageId),
          eq(reactions.userId, me),
          eq(reactions.emoji, emoji),
        ),
      );

    await publishChannelEvent(
      {
        event: GatewayEvent.MESSAGE_REACTION_REMOVE,
        payload: {
          messageId: messageId.toString(),
          channelId: channelId.toString(),
          guildId: access.guildId?.toString() ?? null,
          userId: me.toString(),
          emoji,
        },
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.status(204).send();
  });

  /* ---------------- Arama ---------------- */

  app.get('/guilds/:guildId/messages/search', async (request, reply) => {
    const me = userId(request);
    const guildId = snowflakeParam(request.params, 'guildId');
    await app.rateLimiter.consume('SEARCH', me.toString());

    const query = z
      .object({
        q: z.string().trim().min(2).max(200),
        limit: z.coerce.number().int().min(1).max(50).default(25),
        channelId: z.string().optional(),
      })
      .parse(request.query);

    // Yalnızca kullanıcının görebildiği kanallarda ara — arama, gizli kanal
    // içeriğini sızdırmanın en kolay yoludur.
    const access = await requireGuildAccess(guildId, me);
    const visible = await visibleChannels(access.guild, access.member, guildId);
    const searchable = visible
      .filter((v) => has(v.permissions, Permission.READ_MESSAGE_HISTORY))
      .map((v) => v.channel.id)
      .filter((id) => !query.channelId || id === BigInt(query.channelId));

    if (searchable.length === 0) return reply.send([]);

    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.channelId, searchable),
          isNull(messages.deletedAt),
          sql`to_tsvector('simple', ${messages.content}) @@ plainto_tsquery('simple', ${query.q})`,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(query.limit);

    return reply.send(await hydrate(rows, me));
  });

  /* ---------------- Yazıyor göstergesi ---------------- */

  app.post('/channels/:channelId/typing', async (request, reply) => {
    const me = userId(request);
    const channelId = snowflakeParam(request.params, 'channelId');
    const access = await requireMessageChannel(channelId, me);
    if (!has(access.permissions, Permission.SEND_MESSAGES)) throw Errors.forbidden();
    await app.rateLimiter.consume('TYPING', `${me}:${channelId}`);

    await publishChannelEvent(
      {
        event: GatewayEvent.TYPING_START,
        payload: {
          channelId: channelId.toString(),
          guildId: access.guildId?.toString() ?? null,
          userId: me.toString(),
          timestamp: Math.floor(Date.now() / 1000),
        },
        guildId: access.guildId?.toString(),
        channelId: channelId.toString(),
      },
      access.recipients.map((r) => r.toString()),
    );
    return reply.status(204).send();
  });
}

/**
 * Mesaj satırlarını yazar, ek ve tepki bilgisiyle zenginleştirir.
 * Tek tek sorgu yerine toplu sorgu — N+1 mesaj listesini yavaşlatır.
 */
async function hydrate(rows: Message[], viewerId: bigint) {
  if (rows.length === 0) return [];

  const messageIds = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.authorId))];

  const [authorRows, attachmentRows, reactionRows] = await Promise.all([
    db.select().from(users).where(inArray(users.id, authorIds)),
    db.select().from(attachments).where(inArray(attachments.messageId, messageIds)),
    db.select().from(reactions).where(inArray(reactions.messageId, messageIds)),
  ]);

  const authorsById = new Map<string, User>(authorRows.map((u) => [u.id.toString(), u]));

  const attachmentsByMessage = new Map<string, typeof attachmentRows>();
  for (const row of attachmentRows) {
    if (!row.messageId) continue;
    const key = row.messageId.toString();
    attachmentsByMessage.set(key, [...(attachmentsByMessage.get(key) ?? []), row]);
  }

  // emoji başına sayaç + isteği yapanın tepkisi
  const reactionsByMessage = new Map<string, Map<string, { count: number; me: boolean }>>();
  for (const row of reactionRows) {
    const key = row.messageId.toString();
    const byEmoji = reactionsByMessage.get(key) ?? new Map();
    const entry = byEmoji.get(row.emoji) ?? { count: 0, me: false };
    entry.count += 1;
    if (row.userId === viewerId) entry.me = true;
    byEmoji.set(row.emoji, entry);
    reactionsByMessage.set(key, byEmoji);
  }

  return rows.map((message) => {
    const key = message.id.toString();
    const author = authorsById.get(message.authorId.toString());
    return toAPIMessage({
      message,
      // Yazar silinmişse (KVKK talebi) mesaj kalır, kimlik anonimleşir.
      author:
        author ??
        ({
          id: message.authorId,
          username: 'silinmiş-kullanıcı',
          discriminator: '0000',
          displayName: null,
          avatarUrl: null,
          bio: null,
          isBot: false,
        } as User),
      attachments: attachmentsByMessage.get(key) ?? [],
      reactions: [...(reactionsByMessage.get(key) ?? new Map()).entries()].map(
        ([emoji, value]) => ({ emoji, count: value.count, me: value.me }),
      ),
    });
  });
}
