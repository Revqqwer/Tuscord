/**
 * Snowflake ID — Discord modeli.
 *
 *   (timestamp_ms - EPOCH) << 22 | worker << 12 | sequence
 *
 * Auto-increment yerine bunu kullanıyoruz çünkü:
 *   - zamana göre sıralanabilir → mesaj sayfalaması kürsörle çalışır (OFFSET yok)
 *   - toplam kayıt sayısını sızdırmaz
 *   - ID üretmek için veritabanına gitmek gerekmez (çok düğümlü yazma serbest)
 */

/** Tuscord epoch: 2026-01-01T00:00:00Z. Discord'unkinden farklı — ID'ler çakışmasın. */
export const TUSCORD_EPOCH = 1767225600000;

const TIMESTAMP_SHIFT = 22n;
const WORKER_SHIFT = 12n;
const MAX_WORKER_ID = 1023;
const SEQUENCE_MASK = 4095n; // 12 bit → ms başına 4096 ID

/** API sınırında snowflake'ler her zaman string taşınır — JS number 64 biti tutamaz. */
export type Snowflake = string;

export class SnowflakeGenerator {
  private readonly workerId: bigint;
  private sequence = 0n;
  private lastTimestamp = -1;

  constructor(workerId: number) {
    if (!Number.isInteger(workerId) || workerId < 0 || workerId > MAX_WORKER_ID) {
      throw new RangeError(`workerId 0-${MAX_WORKER_ID} aralığında bir tamsayı olmalı, alınan: ${workerId}`);
    }
    this.workerId = BigInt(workerId);
  }

  next(): bigint {
    let now = Date.now();

    // Saat geriye kaydıysa (NTP düzeltmesi) ID'ler tekrar edebilir — bekle.
    if (now < this.lastTimestamp) {
      now = this.waitUntil(this.lastTimestamp);
    }

    if (now === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & SEQUENCE_MASK;
      if (this.sequence === 0n) {
        // Bu milisaniyedeki 4096 ID tükendi — bir sonrakini bekle.
        now = this.waitUntil(this.lastTimestamp + 1);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = now;

    return (
      (BigInt(now - TUSCORD_EPOCH) << TIMESTAMP_SHIFT) |
      (this.workerId << WORKER_SHIFT) |
      this.sequence
    );
  }

  nextString(): Snowflake {
    return this.next().toString();
  }

  /** Meşgul bekleme — yalnızca ms başına 4096 ID aşıldığında veya saat geri gittiğinde tetiklenir. */
  private waitUntil(target: number): number {
    let now = Date.now();
    while (now < target) now = Date.now();
    return now;
  }
}

/** Bir snowflake'in üretildiği zaman. */
export function snowflakeToDate(id: Snowflake | bigint): Date {
  const value = typeof id === 'bigint' ? id : BigInt(id);
  return new Date(Number(value >> TIMESTAMP_SHIFT) + TUSCORD_EPOCH);
}

/** Belirli bir zamana denk düşen en küçük snowflake — zaman aralığı sorgularında kürsör olarak kullanılır. */
export function snowflakeForTimestamp(date: Date | number): bigint {
  const ms = typeof date === 'number' ? date : date.getTime();
  return BigInt(ms - TUSCORD_EPOCH) << TIMESTAMP_SHIFT;
}

/** Dışarıdan gelen bir değerin geçerli snowflake olup olmadığı (istek doğrulaması). */
export function isSnowflake(value: unknown): value is Snowflake {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20) return false;
  if (!/^\d+$/.test(value)) return false;
  try {
    const n = BigInt(value);
    return n >= 0n && n < 1n << 63n;
  } catch {
    return false;
  }
}
