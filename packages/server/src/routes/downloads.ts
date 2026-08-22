/**
 * Masaüstü uygulaması indirme linki — Homepage.tsx / UserSettings.tsx
 * buraya yönlendirir. requireAuth İSTEMİYOR: davet ekranından bile
 * indirilebilmeli. Tek işi: indirmeyi logla (bkz. schema.ts
 * desktopDownloads), sonra gerçek .exe'ye (Caddy'nin statik sunduğu)
 * 302 ile yönlendir — dosyayı Node üzerinden akıtmıyoruz, 82MB'lık
 * dosyayı proxy'lemek gereksiz yük.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { desktopDownloads } from '../db/schema.js';
import { nextId } from '../lib/id.js';
import { requestIp } from '../app.js';

const DESKTOP_INSTALLER_PATH = '/downloads/Tuscord-Setup-0.1.5.exe';

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/downloads/desktop', async (request, reply) => {
    const ip = requestIp(request);
    // Sayaç kritik değil — insert başarısız olsa da indirme aksamasın.
    await db
      .insert(desktopDownloads)
      .values({
        id: nextId(),
        ip,
        userAgent: request.headers['user-agent'] ?? null,
      })
      .catch((error) => request.log.error({ error }, 'indirme kaydı yazılamadı'));

    return reply.redirect(DESKTOP_INSTALLER_PATH, 302);
  });
}
