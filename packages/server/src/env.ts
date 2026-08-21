/**
 * Ortam değişkenleri — süreç başlarken bir kez doğrulanır.
 * Eksik/hatalı yapılandırma sunucuyu ayağa kaldırmadan, anlaşılır bir hatayla durdurur;
 * yarı çalışan bir sunucudan iyidir.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Depo kökündeki `.env` dosyasını yükler.
 *
 * Node bunu kendiliğinden yapmaz ve dosyanın yeri çalışma dizinine göre
 * değişir (kökten mi, packages/server içinden mi çalıştırıldığı belli olmaz),
 * bu yüzden bu dosyanın konumundan yukarı çıkıyoruz.
 *
 * Üretimde ortam değişkenleri doğrudan konteynere verilir; dosya yoksa
 * sorun değil, doğrulama zaten eksikleri söyler.
 */
function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../.env'), // depo kökü
    resolve(here, '../.env'), // packages/server/.env
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch (error) {
      console.warn(`.env okunamadı (${path}):`, error);
    }
    return;
  }
}

loadDotEnv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SNOWFLAKE_WORKER_ID: z.coerce.number().int().min(0).max(1023).default(1),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET en az 32 karakter olmalı'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('tuscord-media'),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Tuscord <noreply@localhost>'),

  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),

  TRAFFIC_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  ABUSE_CONTACT_EMAIL: z.string().default('abuse@localhost'),

  /**
   * Virgülle ayrılmış IP listesi — bu IP'ler için hız sınırı UYGULANMAZ.
   * Geliştirme/test amaçlı: kendi IP'ni buraya ekleyip tekrar tekrar kayıt/
   * giriş denesen bile 429 almazsın. Yayına çıkmadan boşaltmayı unutma —
   * kimlik denemesi (brute force) korumasını devre dışı bırakır.
   */
  RATE_LIMIT_TRUSTED_IPS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((ip) => ip.trim())
        .filter((ip) => ip.length > 0),
    ),

  // --- Görsel / CSAM taraması ---
  // 'none': tarama yok (yayına çıkmadan bir sağlayıcıyla kapatılmalı).
  // 'webhook': yüklenen görsel IMAGE_SCAN_WEBHOOK_URL'e POST edilir.
  IMAGE_SCAN_PROVIDER: z.enum(['none', 'webhook']).default('none'),
  IMAGE_SCAN_WEBHOOK_URL: z.string().url().optional(),
  IMAGE_SCAN_WEBHOOK_TOKEN: z.string().optional(),
  IMAGE_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  // Tarama başarısızsa: 'open' içeriği geçir+pending, 'closed' içeriği engelle.
  IMAGE_SCAN_FAIL_MODE: z.enum(['open', 'closed']).default('open'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${issues}\n\n.env.example dosyasına bak.`);
  }
  // Üretimde güvenlik varsayılanlarını zorla — yanlışlıkla HTTP cookie ile canlıya çıkmayı önler.
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('production ortamında COOKIE_SECURE=true olmalı');
  }
  return parsed.data;
}

export const env: Env = load();
export const isProduction = env.NODE_ENV === 'production';
