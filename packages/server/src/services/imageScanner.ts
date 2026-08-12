/**
 * Görsel tarama katmanı — CSAM ve kötücül içerik (spec Bölüm 8).
 *
 * TASARIM: Tarayıcı takılıp çıkarılabilir (pluggable). Gerçek CSAM taraması
 * bir dış servis gerektirir — kod bunu icat edemez, yalnızca ona köprü kurar:
 *
 *   - `none`     (varsayılan) tarama yok. Görseller yükleme anında geçer ama
 *                otomatik olarak moderatör kuyruğuna DÜŞMEZ; bu bilinçli bir
 *                boşluktur ve yayına çıkmadan gerçek bir sağlayıcıyla kapatılmalı.
 *   - `webhook`  yüklenen görseli bir HTTP uca gönderir ve karar bekler.
 *                PhotoDNA/Thorn Safer/Hive gibi servislerin önüne konan ince
 *                bir aracıya ya da doğrudan onların API'sine bağlanır.
 *
 * Cloudflare CSAM Scanning Tool AYRI bir yoldur: zone (domain) seviyesinde
 * çalışır, Cloudflare üzerinden SERVİS edilen görselleri tarar ve eşleşmeyi
 * doğrudan NCMEC'e bildirir. Kod gerektirmez — domain Cloudflare'de olmalı,
 * görseller turuncu bulut (proxy) üzerinden geçmeli ve panelden aktive
 * edilmeli. Bu pasif bir katman; `webhook` ise yükleme anında aktif engelleme.
 * İkisi birlikte kullanılabilir.
 */

import { env } from '../env.js';
import type { DetectedType } from './fileType.js';

/**
 * clean   — içerik temiz, servis edilebilir
 * flagged — içerik işaretlendi; erişime kapatılır, moderatör kuyruğuna düşer
 * error   — tarama yapılamadı (servis çöktü, zaman aşımı); çağıran fail-mode'a karar verir
 */
export type ScanVerdict = 'clean' | 'flagged' | 'error';

export interface ScanInput {
  body: Buffer;
  type: DetectedType;
}

export interface ImageScanner {
  readonly name: string;
  scan(input: ScanInput): Promise<ScanVerdict>;
}

/* ------------------------------------------------------------------ */
/* none — tarama yok                                                   */
/* ------------------------------------------------------------------ */

class NoopScanner implements ImageScanner {
  readonly name = 'none';
  async scan(): Promise<ScanVerdict> {
    // Hiçbir tarama yapılmadı. 'clean' dönmek her görseli geçirir — bu, bir
    // sağlayıcı bağlanana kadar geçerli olan bilinçli boşluktur.
    return 'clean';
  }
}

/* ------------------------------------------------------------------ */
/* webhook — dış tarama servisi                                        */
/* ------------------------------------------------------------------ */

/**
 * Görseli bir HTTP uca `multipart/form-data` olarak POST eder.
 *
 * Beklenen yanıt (200): `{ "verdict": "clean" | "flagged" }`
 * veya `{ "flagged": true | false }`. Başka her şey `error` sayılır.
 *
 * Yetkilendirme: `Authorization: Bearer <token>` (SCAN_WEBHOOK_TOKEN).
 */
class WebhookScanner implements ImageScanner {
  readonly name = 'webhook';

  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async scan(input: ScanInput): Promise<ScanVerdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([input.body], { type: input.type.mime }),
        `upload.${input.type.extension}`,
      );

      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.token ? { authorization: `Bearer ${this.token}` } : undefined,
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(`[tarama] webhook ${response.status}`);
        return 'error';
      }

      const data = (await response.json()) as { verdict?: string; flagged?: boolean };
      if (data.verdict === 'flagged' || data.flagged === true) return 'flagged';
      if (data.verdict === 'clean' || data.flagged === false) return 'clean';

      console.error('[tarama] webhook beklenmeyen yanıt', data);
      return 'error';
    } catch (error) {
      // Zaman aşımı, ağ hatası, geçersiz JSON — hepsi error.
      console.error('[tarama] webhook çağrısı başarısız', error);
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ */

function createScanner(): ImageScanner {
  if (env.IMAGE_SCAN_PROVIDER === 'webhook') {
    if (!env.IMAGE_SCAN_WEBHOOK_URL) {
      throw new Error(
        'IMAGE_SCAN_PROVIDER=webhook için IMAGE_SCAN_WEBHOOK_URL zorunlu',
      );
    }
    return new WebhookScanner(
      env.IMAGE_SCAN_WEBHOOK_URL,
      env.IMAGE_SCAN_WEBHOOK_TOKEN,
      env.IMAGE_SCAN_TIMEOUT_MS,
    );
  }
  return new NoopScanner();
}

export const imageScanner: ImageScanner = createScanner();
export const scanningEnabled = imageScanner.name !== 'none';

/**
 * Tarama başarısız olduğunda (verdict = error) içeriğe ne yapılacağı.
 *
 * fail-open (varsayılan): içerik geçer ama `pending` kalır ve kuyruğa düşer —
 *   servis çöktü diye tüm yüklemeleri durdurmak DoS'a açık kapıdır.
 * fail-closed: içerik `flagged` sayılır ve engellenir — CSAM açısından en
 *   güvenli ama tarama servisi her çöktüğünde yüklemeler görünmez olur.
 *
 * İkisi arasındaki seçim yasal/operasyonel bir karar; env ile ayarlanır.
 */
export const failMode = env.IMAGE_SCAN_FAIL_MODE;
