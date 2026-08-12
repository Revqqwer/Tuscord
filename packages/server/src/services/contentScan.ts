/**
 * Yüklenen görsellerin taranması (spec Bölüm 8).
 *
 * Bu dosya YALNIZCA orkestrasyon: hangi ekin taranacağı, sonucun veritabanına
 * nasıl yazılacağı, işaretli içeriğin moderatör kuyruğuna nasıl düşeceği.
 * Asıl karar (temiz mi, işaretli mi) `imageScanner`'a devredilir — sağlayıcı
 * takılıp çıkarılabilir (none | webhook | Cloudflare zone). Bkz. imageScanner.ts.
 *
 * Kritik tasarım kararı: tarama **yükleme anında değil, arkasından** çalışır
 * ve sonuç gelene kadar ek `pending` durumundadır. Yükleme isteğini taramanın
 * bitmesine bağlamak, tarayıcı yavaşladığında tüm yüklemeleri durdurur ve
 * DoS'a açık kapı bırakır.
 *
 * `pending` eklerin nasıl davrandığı önemli: mesaja iliştirilebilir ama
 * `flagged` olursa mesajla birlikte erişime kapatılır (routes/attachments.ts
 * media uçları `flagged`'ı 404 yapar) ve moderatör kuyruğuna düşer.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { attachments, reports } from '../db/schema.js';
import { nextId } from '../lib/id.js';
import { failMode, imageScanner } from './imageScanner.js';
import type { DetectedType } from './fileType.js';

export type ScanStatus = 'pending' | 'clean' | 'flagged';

export interface ScanRequest {
  attachmentId: bigint;
  uploaderId: bigint;
  body: Buffer;
  type: DetectedType;
}

/**
 * Taramayı kuyruğa alır. Yükleme isteğini bloke ETMEZ (arka planda çalışır).
 */
export function queueScan(request: ScanRequest): void {
  void runScan(request).catch((error) => {
    console.error('[tarama] başarısız', { attachmentId: request.attachmentId.toString(), error });
  });
}

/** Test edilebilirlik için ayrık: karar mantığı saf, veritabanına dokunmaz. */
export async function resolveScanStatus(request: ScanRequest): Promise<ScanStatus> {
  // Görsel olmayan dosyalar görsel taramasının kapsamı dışında.
  if (request.type.kind !== 'image') return 'clean';

  const verdict = await imageScanner.scan({ body: request.body, type: request.type });

  switch (verdict) {
    case 'flagged':
      return 'flagged';
    case 'clean':
      return 'clean';
    case 'error':
      // Tarama yapılamadı. fail-closed → engelle; fail-open → pending bırak
      // (görünür ama moderatör kuyruğunda). Bkz. imageScanner.failMode.
      return failMode === 'closed' ? 'flagged' : 'pending';
  }
}

async function runScan(request: ScanRequest): Promise<void> {
  const status = await resolveScanStatus(request);

  await db
    .update(attachments)
    .set({ scanStatus: status })
    .where(eq(attachments.id, request.attachmentId));

  // İşaretlenen içerik otomatik olarak moderatör kuyruğuna düşer:
  // kimsenin rapor etmesini beklemeyiz.
  if (status === 'flagged') {
    await db.insert(reports).values({
      id: nextId(),
      reporterId: request.uploaderId,
      targetType: 'message',
      targetId: request.attachmentId,
      reason: 'Otomatik tarama: içerik işaretlendi',
      status: 'open',
      snapshot: { source: 'content_scan', attachmentId: request.attachmentId.toString() },
    });
  }
}
