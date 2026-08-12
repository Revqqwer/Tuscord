import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { authRoutes } from './auth.js';
import { userRoutes } from './users.js';
import { guildRoutes } from './guilds.js';
import { channelRoutes } from './channels.js';
import { messageRoutes } from './messages.js';
import { inviteRoutes } from './invites.js';
import { moderationRoutes } from './moderation.js';
import { attachmentRoutes } from './attachments.js';
import { friendRoutes } from './friends.js';
import { adminRoutes } from './admin.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  /**
   * Hukuki iletişim ucu. 5651 ve KVKK, erişilebilir bir başvuru kanalı
   * zorunlu kılıyor; arayüzdeki /legal sayfası bunu kullanır.
   */
  app.get('/legal/contact', async () => ({
    abuseEmail: env.ABUSE_CONTACT_EMAIL,
    /** Yer sağlayıcı: Türkiye. Kaldırma talepleri 24/48 saat içinde işlenir. */
    hostingCountry: 'TR',
    trafficLogRetentionDays: env.TRAFFIC_LOG_RETENTION_DAYS,
  }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(guildRoutes);
      await api.register(channelRoutes);
      await api.register(messageRoutes);
      await api.register(inviteRoutes);
      await api.register(moderationRoutes);
      await api.register(attachmentRoutes);
      await api.register(friendRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/api/v1' },
  );
}
