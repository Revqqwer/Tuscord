/**
 * Kimin hangi ses kanalında olduğu — Gateway'in kendi `voiceStates`
 * Map'inden BİLEREK ayrı, küçük bir modül: REST katmanı (messages.ts,
 * channels.ts, gateway pubsub gating) buradan okuyabilsin diye. Aynı
 * süreçte çalıştığımız için (bkz. index.ts: API+gateway tek HTTP sunucusu
 * paylaşıyor) bellek içi yeterli — çok düğümlü olunca Redis'e taşınır.
 *
 * Amaç: bir moderatör MOVE_MEMBERS ile birini VIEW_CHANNEL'ı olmayan bir
 * ses kanalına taşıdığında (bkz. gateway/index.ts forceMoveVoice), o
 * kullanıcı O KANALDA kaldığı sürece kanalın metin sohbetini görebilsin ve
 * ekran paylaşabilsin — fiziksel bulunuş, biçimsel role/overwrite iznini
 * GEÇİCİ olarak baypas eder (Discord'un davranışıyla aynı, bkz. kullanıcı
 * isteği). Kanaldan ayrılınca (leaveVoice) bu bypass da biter.
 */
const presence = new Map<string, string>(); // userId -> channelId

export function setVoicePresence(userId: string, channelId: string): void {
  presence.set(userId, channelId);
}

export function clearVoicePresence(userId: string): void {
  presence.delete(userId);
}

export function isInVoiceChannel(userId: string, channelId: string): boolean {
  return presence.get(userId) === channelId;
}
