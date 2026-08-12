/**
 * Sunucu girişi. API ve gateway aynı HTTP sunucusunu paylaşır:
 * bu ölçekte ayrı süreç çalıştırmanın getirisi yok, ayırmak gerekirse
 * gateway'i kendi sürecine taşımak (farklı SNOWFLAKE_WORKER_ID ile) yeterli.
 */

import { buildApp } from './app.js';
import { Gateway } from './gateway/index.js';
import { env } from './env.js';
import { closeRedis } from './redis.js';
import { sql } from './db/index.js';
import { pruneExpiredSessions } from './auth/session.js';
import { pruneTrafficLogs } from './services/compliance.js';
import { verifyMailConnection } from './services/mail.js';
import { imageScanner, scanningEnabled } from './services/imageScanner.js';

const app = await buildApp();
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

const gateway = new Gateway(app.server);
app.log.info(`Gateway hazır: ws://localhost:${env.API_PORT}/gateway`);

// SMTP kimlik bilgilerini erkenden doğrula: yanlış yapılandırmayı ilk kayıt
// denemesinde değil, açılışta gör. Gönderimi bloke etmez, yalnızca bilgilendirir.
void verifyMailConnection().then((ok) => {
  if (ok) app.log.info('SMTP bağlantısı doğrulandı');
  else if (env.SMTP_HOST) app.log.warn('SMTP yapılandırıldı ama doğrulanamadı');
  else app.log.warn('SMTP yapılandırılmadı — e-postalar konsola yazılıyor (geliştirme)');
});

// Görsel tarama durumu. Üretimde 'none' ise yüksek sesle uyar: internete açık,
// kayıt alan bir platformda görsel taraması hukuki bir yükümlülük.
if (scanningEnabled) {
  app.log.info(`Görsel tarama aktif: ${imageScanner.name}`);
} else if (env.NODE_ENV === 'production') {
  app.log.warn(
    'DİKKAT: görsel/CSAM taraması KAPALI (IMAGE_SCAN_PROVIDER=none). ' +
      'Yayına çıkmadan bir sağlayıcı bağla veya Cloudflare CSAM Scanning Tool aktive et.',
  );
}

/**
 * Günlük bakım: süresi dolan oturumlar ve saklama süresi dolan trafik kayıtları.
 * Trafik kaydı temizliği KVKK yükümlülüğü — "gerektiğinden uzun saklama".
 */
const maintenance = setInterval(
  () => {
    void (async () => {
      try {
        const sessionsRemoved = await pruneExpiredSessions();
        const logsRemoved = await pruneTrafficLogs();
        app.log.info({ sessionsRemoved, logsRemoved }, 'bakım tamamlandı');
      } catch (error) {
        app.log.error({ error }, 'bakım görevi başarısız');
      }
    })();
  },
  6 * 3_600_000,
);

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} alındı, kapanılıyor`);
  clearInterval(maintenance);
  await gateway.close();
  await app.close();
  await closeRedis();
  await sql.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
