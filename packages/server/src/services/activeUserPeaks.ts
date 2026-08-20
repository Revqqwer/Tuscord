/**
 * Gün başına en yüksek eşzamanlı aktif kullanıcı rekoru — admin panelindeki
 * "Genel bakış" sekmesi için (bkz. routes/admin.ts, db/schema.ts
 * activeUserPeaks). Bir kullanıcı gateway'e bağlandığında (bkz.
 * gateway/index.ts register) o anki toplam eşzamanlı kullanıcı sayısı
 * buraya bildirilir; bugünün ya da tüm zamanların rekoru kırıldıysa
 * güncellenir.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { activeUserPeaks } from '../db/schema.js';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** `currentCount` bugünün rekorunu kırdıysa kaydeder — kırmadıysa hiçbir şey yazmaz. */
export async function recordActiveUserCount(currentCount: number): Promise<void> {
  const day = todayUTC();
  try {
    const existing = await db.query.activeUserPeaks.findFirst({ where: eq(activeUserPeaks.day, day) });
    if (!existing) {
      await db.insert(activeUserPeaks).values({ day, peak: currentCount }).onConflictDoNothing();
      return;
    }
    if (currentCount > existing.peak) {
      await db
        .update(activeUserPeaks)
        .set({ peak: currentCount, updatedAt: new Date() })
        .where(eq(activeUserPeaks.day, day));
    }
  } catch (error) {
    // İstatistik amaçlı — bir bağlantı/açılış anını bloke etmemeli.
    console.error('[active-user-peaks] kayıt yazılamadı', error);
  }
}

export interface ActiveUserStats {
  /** Bugünkü (UTC) en yüksek eşzamanlı kullanıcı sayısı. */
  dailyPeak: number;
  /** Tüm zamanların rekoru — bu tablodaki tüm günlerin MAX'ı. */
  allTimePeak: number;
}

export async function getActiveUserStats(): Promise<ActiveUserStats> {
  const day = todayUTC();
  const [dailyRow, allTimeRows] = await Promise.all([
    db.query.activeUserPeaks.findFirst({ where: eq(activeUserPeaks.day, day) }),
    db.select({ maxPeak: sql<number>`max(${activeUserPeaks.peak})` }).from(activeUserPeaks),
  ]);
  return {
    dailyPeak: dailyRow?.peak ?? 0,
    allTimePeak: allTimeRows[0]?.maxPeak ?? 0,
  };
}
