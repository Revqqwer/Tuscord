/**
 * Şu an gateway'e bağlı (en az bir oturumu açık) kullanıcı kümesi.
 *
 * Gateway'in kendi `userIndex`'inden (gateway/index.ts) BİLEREK ayrı, küçük
 * bir modül: REST katmanı (admin.ts) buradan okuyabilsin diye — aynı desen
 * voicePresence.ts'te de kullanıldı. Aynı süreçte çalıştığımız için bellek
 * içi yeterli (bkz. index.ts: API+gateway tek HTTP sunucusu paylaşıyor).
 */
const online = new Set<string>();

export function markOnline(userId: string): void {
  online.add(userId);
}

export function markOffline(userId: string): void {
  online.delete(userId);
}

export function onlineUserCount(): number {
  return online.size;
}
