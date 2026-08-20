/**
 * Bot token kimlik doğrulaması.
 *
 * İnsan oturumlarından (session.ts) BİLEREK ayrı: bot token'ları cookie'de
 * değil `Authorization: Bot <token>` header'ında taşınır, süresi dolmaz
 * (uygulama silinene/yenilenene kadar geçerli) ve Redis'te önbelleklenmez —
 * bot trafiği insan trafiğine kıyasla çok daha seyrek, ekstra karmaşığa değmez.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { botApplications, users } from '../db/schema.js';
import {
  generateToken,
  hashToken,
  resolveSession,
  type AuthenticatedSession,
} from './session.js';

/** Bot token'ları bu önekle başlar — insan oturum token'larından ayırt etmek için. */
export const BOT_TOKEN_PREFIX = 'tcb_';

export function isBotToken(token: string): boolean {
  return token.startsWith(BOT_TOKEN_PREFIX);
}

export function generateBotToken(): string {
  return BOT_TOKEN_PREFIX + generateToken();
}

/** Bot token'ını çözer. Geçersizse null — asla fırlatmaz (bkz. resolveSession). */
export async function resolveBotToken(token: string): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(token);
  const app = await db.query.botApplications.findFirst({ where: eq(botApplications.tokenHash, tokenHash) });
  if (!app) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, app.botUserId) });
  if (!user || user.isDisabled || user.deletedAt) return null;

  return {
    // Bot'ların insan oturumu gibi bir "session"ı yok; application id burada
    // sadece alanı doldurmak için — hiçbir yerde anlamlı biçimde okunmuyor.
    sessionId: app.id,
    user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      locale: user.locale,
      isBot: true,
      mfaEnabled: false,
      isAdmin: false,
    },
  };
}

/** Cookie/gateway IDENTIFY token'ını insan oturumu ya da bot token'ı olarak çözer. */
export async function resolveAnyToken(token: string): Promise<AuthenticatedSession | null> {
  return isBotToken(token) ? resolveBotToken(token) : resolveSession(token);
}
