/**
 * Yeni mesaj / bahsetme bildirim sesleri.
 *
 * voiceChime.ts ile aynı gerekçe: dosya yok, Web Audio API ile anlık üretilen
 * kısa tonlar — sıfır varlık, sıfır lisans riski. Ses kanalı katılma/ayrılma
 * tonlarından BİLEREK farklı frekanslarda: aynı anda sesli kanaldayken bir
 * mesaj gelirse ikisi karışmasın.
 *
 * İki ayrı ton: normal mesaj sade tek nota, bahsetme (@kullanıcı) daha
 * belirgin iki nota — kullanıcı duyduğu anda "bu bana mı?" ayrımını
 * yapabilsin (bkz. kullanıcı isteği: "farklı bir bildirim türü").
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  audioCtx ??= new AudioContext();
  return audioCtx;
}

function beep(c: AudioContext, freq: number, start: number, duration: number, peak: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playMessageChime(kind: 'message' | 'mention'): void {
  try {
    const c = ctx();
    if (c.state === 'suspended') void c.resume();
    if (kind === 'mention') {
      // Bahsetme: daha yüksek, iki net nota — dikkat çeksin.
      beep(c, 880, c.currentTime, 0.08, 0.18);
      beep(c, 1175, c.currentTime + 0.08, 0.12, 0.18);
    } else {
      // Normal mesaj: tek, sade, kısık ton.
      beep(c, 587, c.currentTime, 0.06, 0.1);
    }
  } catch {
    // AudioContext yoksa/engellendiyse sessizce geç — kritik olmayan bir bildirim.
  }
}
