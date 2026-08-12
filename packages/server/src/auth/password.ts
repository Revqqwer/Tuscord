import argon2 from 'argon2';

/**
 * argon2id parametreleri.
 *
 * OWASP asgarisi (2024): m=19 MiB, t=2, p=1. Biraz üstünü alıyoruz —
 * 300-1000 kullanıcı ölçeğinde giriş sıklığı düşük, hash maliyeti sorun değil.
 * Bunları DÜŞÜRME: parola veritabanı sızarsa tek savunma bu.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 47_104, // 46 MiB
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Bozuk/eski format hash — doğrulama başarısız sayılır, süreç düşmez.
    return false;
  }
}

/** Parametreler sıkılaştırıldığında mevcut hash'lerin yenilenmesi gerekir mi. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}
