/**
 * Ses kanalı katılma/ayrılma bildirim sesleri.
 *
 * KASITLI OLARAK dosya indirilmedi: Web Audio API ile anlık üretilen iki
 * kısa "cıvıltı" — katılma yukarı doğru iki nota, ayrılma aşağı doğru iki
 * nota. Sıfır varlık, sıfır lisans riski, sıfır depolama (aynı gerekçeyle
 * kanal sticker'ları da emoji seçildi, bkz. shared/limits.ts CHANNEL_STICKERS).
 * İleride gerçek bir ses tasarımcısından dosya gelirse, tek değişiklik burada
 * `<audio>` ile çalmaya geçmek olur — çağıran taraflar (voice.ts,
 * useGateway.ts) değişmez.
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  audioCtx ??= new AudioContext();
  return audioCtx;
}

function beep(c: AudioContext, freq: number, start: number, duration: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Tık sesini önlemek için hızlı fade-in/out (exponential ramp 0'a gidemez, 0.0001 kullanılır).
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playVoiceChime(kind: 'join' | 'leave' | 'live'): void {
  try {
    const c = ctx();
    if (c.state === 'suspended') void c.resume();
    if (kind === 'live') {
      // Canlı yayın başladı: kısa, tiz üç nota — katılma/ayrılmadan net ayrılsın.
      beep(c, 587, c.currentTime, 0.07);
      beep(c, 784, c.currentTime + 0.07, 0.07);
      beep(c, 988, c.currentTime + 0.14, 0.12);
      return;
    }
    // Katılma: yukarı iki nota (A4→E5). Ayrılma: aşağı iki nota (C5→F#4) — kulakla ayırt edilsin diye.
    const [f1, f2] = kind === 'join' ? [440, 660] : [523, 370];
    beep(c, f1, c.currentTime, 0.09);
    beep(c, f2, c.currentTime + 0.09, 0.11);
  } catch {
    // AudioContext yoksa/engellendiyse sessizce geç — kritik olmayan bir bildirim.
  }
}

/**
 * Bir kanala YENİ katılınca sunucu, oradaki herkesin mevcut durumunu
 * "yakalama" (catch-up) paketleri olarak gönderir (bkz. server:
 * handleVoiceState). Bunlar gerçek katılma OLAYLARI değil — kalabalık bir
 * kanala girer girmez art arda "katıldı" sesi patlamasın diye kısa bir
 * pencerede bastırılır.
 */
const CATCH_UP_SUPPRESS_MS = 700;
let suppressUntil = 0;

export function suppressChimesForCatchUp(): void {
  suppressUntil = Date.now() + CATCH_UP_SUPPRESS_MS;
}

export function chimesSuppressed(): boolean {
  return Date.now() < suppressUntil;
}
