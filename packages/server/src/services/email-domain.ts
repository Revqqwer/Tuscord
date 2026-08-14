/**
 * E-posta alan adının gerçekten posta alabilir olduğunu DNS ile doğrular.
 *
 * Biçim doğrulaması (zod `.email()`) `gmial.com` gibi yazım hatalarını
 * yakalayamaz: biçim geçerlidir ama adres teslim edilemez. Doğrulama maili
 * boşluğa gider, kullanıcı hesabını hiç açamaz ve Brevo tarafında sert geri
 * dönüş (hard bounce) birikir — bu da gönderen itibarımızı düşürür.
 *
 * Politika:
 *  - MX kaydı varsa geçerli.
 *  - MX yoksa A/AAAA kaydına bakılır: RFC 5321 §5.1 gereği MX'i olmayan bir
 *    alan adında adres kaydı örtük MX sayılır.
 *  - Alan adı hiç yoksa (NXDOMAIN) reddedilir.
 *  - DNS'in kendisi hata verirse (timeout, SERVFAIL) KABUL edilir. Kendi
 *    çözümleyicimizdeki geçici arıza yüzünden gerçek kullanıcıyı kaydolamaz
 *    hâle getirmek, birkaç şüpheli adresi geçirmekten daha pahalı.
 */

import { Resolver } from 'node:dns/promises';

/**
 * Sistem çözümleyicisi KULLANILMAZ. Konteyner içinde Docker'ın gömülü DNS'i
 * (127.0.0.11) var olmayan bir alan adı için cevabı ~8 saniyede döndürüyor
 * (upstream'i yeniden deniyor); gerçek alan adları 20-90 ms. Yani tam da
 * yakalamak istediğimiz durumda sorgu en yavaş hâline geliyor ve makul her
 * zaman aşımı "DNS arızası" gibi görünüp adresi geçiriyordu.
 *
 * Doğrudan Cloudflare çözümleyicisine sorunca aynı alan adı 16 ms'de
 * ENOTFOUND dönüyor. Alan adımız zaten Cloudflare'de.
 */
const resolver = new Resolver({ timeout: 2_000, tries: 2 });
resolver.setServers(['1.1.1.1', '1.0.0.1']);

/** Alan adı → geçerli mi, ne zamana kadar önbellekte. */
const cache = new Map<string, { valid: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 6 * 3_600_000; // 6 saat
const CACHE_MAX = 5_000;

/** DNS hatasının "alan adı yok" anlamına gelip gelmediği. */
function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN';
}

async function lookup(domain: string): Promise<boolean> {
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.some((record) => record.exchange && record.exchange !== '.')) return true;
    // Tek bir "null MX" (RFC 7505): alan adı posta kabul etmediğini AÇIKÇA
    // ilan ediyor. A kaydına düşmenin anlamı yok.
    if (mx.length > 0) return false;
  } catch {
    // MX sorgusunun hatası tek başına karar vermeye yetmez: bazı çözümleyiciler
    // var olmayan alan adı için ENOTFOUND yerine ESERVFAIL döner. Ayrımı
    // aşağıdaki A kaydı sorgusu yapar.
  }

  try {
    await resolver.resolve(domain);
    return true; // Örtük MX (RFC 5321 §5.1).
  } catch (error) {
    // Alan adı gerçekten yok → reddet. Başka her hata (timeout, SERVFAIL)
    // bizim tarafımızdaki arıza olabilir → geçir.
    return !isNotFound(error);
  }
}

/**
 * Adresin alan adı posta alabiliyor mu? Ağ hatasında `true` döner (fail-open).
 */
export async function emailDomainDeliverable(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  const hit = cache.get(domain);
  if (hit && hit.expiresAt > Date.now()) return hit.valid;

  const valid = await lookup(domain);

  // Kaba ama yeterli budama: sınıra gelince en eski girdiyi at.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(domain, { valid, expiresAt: Date.now() + CACHE_TTL_MS });
  return valid;
}
