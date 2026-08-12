/**
 * Dosya yükleme ve sunum.
 *
 * Akış: istemci önce dosyayı yükler (ek `messageId` olmadan oluşur), sonra
 * dönen ek kimliğini mesaj gövdesinde gönderir. Böylece yükleme sırasında
 * ilerleme gösterilebiliyor ve mesaj gönderimi hızlı kalıyor.
 *
 * Güvenlik (spec Bölüm 8):
 *  - tip doğrulaması magic byte ile, beyaz liste
 *  - boyut sınırı ve kullanıcı başına hız sınırı
 *  - tahmin edilemez nesne anahtarı
 *  - `Content-Disposition: attachment` ile sunum: tarayıcı dosyayı
 *    origin üzerinde ÇALIŞTIRMAZ, indirir (saklı XSS'in önü kesilir)
 */

import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { Limits, Permission, has } from '@tuscord/shared';
import { db } from '../db/index.js';
import { attachments } from '../db/schema.js';
import { Errors } from '../lib/errors.js';
import { nextId } from '../lib/id.js';
import { userId, requestIp } from '../app.js';
import { requireMessageChannel } from '../services/channelAccess.js';
import { detectFileType, sanitizeFilename } from '../services/fileType.js';
import { generateObjectKey, storage, usingLocalStorage } from '../services/storage.js';
import { queueScan } from '../services/contentScan.js';
import { logTraffic } from '../services/compliance.js';
import { toAPIAttachment } from '../services/serialize.js';
import { snowflakeParam } from '../lib/validate.js';

/** Nesne anahtarının uzantısından güvenli görsel MIME tipi. */
function mimeFromExtension(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------- Yükleme ---------------- */

  app.post(
    '/channels/:channelId/attachments',
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const me = userId(request);
      const channelId = snowflakeParam(request.params, 'channelId');

      const access = await requireMessageChannel(channelId, me);
      if (!has(access.permissions, Permission.ATTACH_FILES)) {
        throw Errors.forbidden('missing_attach_files', 'Dosya ekleme iznin yok');
      }
      await app.rateLimiter.consume('ATTACHMENT_UPLOAD', me.toString());

      const file = await request.file({
        limits: { fileSize: Limits.ATTACHMENT_SIZE_MAX, files: 1 },
      });
      if (!file) throw Errors.badRequest('missing_file', 'Dosya gönderilmedi');

      const body = await file.toBuffer().catch(() => null);
      if (!body) throw Errors.tooLarge();
      // toBuffer sınırı aşarsa kesebilir; boyutu ayrıca doğrula.
      if (file.file.truncated || body.byteLength > Limits.ATTACHMENT_SIZE_MAX) {
        throw Errors.tooLarge(`Dosya en fazla ${Limits.ATTACHMENT_SIZE_MAX / 1024 / 1024} MB olabilir`);
      }
      if (body.byteLength === 0) throw Errors.badRequest('empty_file', 'Dosya boş');

      // İstemcinin bildirdiği content-type'a GÜVENİLMEZ; içeriğe bakılır.
      const type = detectFileType(body);
      if (!type) {
        throw Errors.badRequest('unsupported_file_type', 'Bu dosya türü desteklenmiyor');
      }

      const filename = sanitizeFilename(file.filename);
      const objectKey = generateObjectKey('attachments', type.extension);
      await storage.put(objectKey, body, type.mime);

      const attachmentId = nextId();
      await db.insert(attachments).values({
        id: attachmentId,
        messageId: null, // mesaja gönderim sırasında bağlanır
        uploaderId: me,
        filename,
        size: body.byteLength,
        contentType: type.mime,
        objectKey,
        scanStatus: 'pending',
      });

      // Tarama arka planda; yükleme cevabını bekletmez.
      queueScan({ attachmentId, uploaderId: me, body, type });

      // 5651: yükleme bir erişim olayıdır, trafik kaydına yazılır.
      await logTraffic({
        userId: me,
        eventType: 'upload',
        ip: requestIp(request),
        userAgent: request.headers['user-agent'] ?? null,
      });

      const row = await db.query.attachments.findFirst({
        where: eq(attachments.id, attachmentId),
      });
      return reply.status(201).send(toAPIAttachment(row!));
    },
  );

  /* ---------------- Sunum ---------------- */

  /**
   * Yerel depolamada dosyaları API sunar. Üretimde R2 herkese açık alan
   * adından servis edildiği için bu yol yalnızca yedek olarak kalır.
   *
   * Kimlik doğrulaması kasıtlı olarak yok: nesne anahtarı 128 bit rastgele,
   * yani bağlantıyı bilen erişir (Discord ile aynı model). Kanal izni
   * kontrolü eklemek, paylaşılan bağlantıları ve önizlemeleri bozardı.
   */
  app.get('/media/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'];
    if (!key) throw Errors.notFound();

    // Avatarlar `users` tablosunda tutulur, `attachments`'ta değil — doğrudan
    // depolamadan servis edilir ve satır içi (inline) gösterilir. Görsel
    // olduğu yükleme anında magic byte ile doğrulandı.
    if (key.startsWith('avatars/')) {
      const body = await storage.get(key);
      if (!body) throw Errors.notFound();
      return reply
        .header('Content-Type', mimeFromExtension(key))
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(body);
    }

    const row = await db.query.attachments.findFirst({
      where: eq(attachments.objectKey, key),
    });
    if (!row) throw Errors.notFound();

    // İşaretlenen içerik servis edilmez.
    if (row.scanStatus === 'flagged') {
      throw Errors.notFound('content_removed', 'İçerik kaldırıldı');
    }

    const body = await storage.get(key);
    if (!body) throw Errors.notFound();

    return reply
      .header('Content-Type', row.contentType)
      // Dosya origin üzerinde çalıştırılmasın diye indirmeye zorlanır.
      .header('Content-Disposition', `attachment; filename="${row.filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(body);
  });

  /**
   * Görsel önizleme: aynı dosya, ama tarayıcıda gösterilebilir biçimde.
   * Yalnızca güvenli görsel tipleri; SVG hiç kabul edilmediği için burada
   * da ortaya çıkamaz.
   */
  app.get('/media-inline/*', async (request, reply) => {
    const key = (request.params as Record<string, string>)['*'];
    if (!key) throw Errors.notFound();

    const row = await db.query.attachments.findFirst({
      where: eq(attachments.objectKey, key),
    });
    if (!row || row.scanStatus === 'flagged') throw Errors.notFound();
    if (!row.contentType.startsWith('image/')) {
      throw Errors.notFound('not_previewable', 'Bu dosya önizlenemez');
    }

    const body = await storage.get(key);
    if (!body) throw Errors.notFound();

    return reply
      .header('Content-Type', row.contentType)
      .header('Content-Disposition', 'inline')
      // nosniff + yalnızca image/* servis etme koşulu, dosyanın HTML olarak
      // yorumlanmasını engellemeye yeter. CSP'ye `sandbox` EKLEME: alt kaynak
      // yanıtında opak origin yaratır ve tarayıcı görseli hiç çizmez.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'")
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(body);
  });

  /* ---------------- Temizlik ---------------- */

  /**
   * Mesaja iliştirilmemiş ekler: kullanıcı dosya yükleyip mesajı
   * göndermekten vazgeçtiğinde kalır. Günlük temizlikte silinir.
   */
  app.delete('/attachments/:attachmentId', { preHandler: app.requireAuth }, async (request, reply) => {
    const me = userId(request);
    const attachmentId = snowflakeParam(request.params, 'attachmentId');

    const row = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.uploaderId, me),
        isNull(attachments.messageId),
      ),
    });
    if (!row) throw Errors.notFound('unknown_attachment', 'Ek bulunamadı');

    await storage.delete(row.objectKey);
    await db.delete(attachments).where(eq(attachments.id, attachmentId));
    return reply.status(204).send();
  });

  if (usingLocalStorage) {
    // Yerel disk üretimde de geçerli (tek sunucu, düşük ölçek). Tek şart:
    // yükleme dizini kalıcı bir Docker volume'e bağlı olmalı (compose.prod.yml).
    app.log.info('Dosya depolama: yerel disk (var/uploads). R2 için .env doldur.');
  }
}
