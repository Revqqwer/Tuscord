import { describe, it, expect } from 'vitest';
import {
  SnowflakeGenerator,
  snowflakeToDate,
  snowflakeForTimestamp,
  isSnowflake,
  TUSCORD_EPOCH,
} from './snowflake.js';

describe("SnowflakeGenerator", () => {
  it("geçersiz worker kimliğini reddeder", () => {
    expect(() => new SnowflakeGenerator(-1)).toThrow(RangeError);
    expect(() => new SnowflakeGenerator(1024)).toThrow(RangeError);
    expect(() => new SnowflakeGenerator(1.5)).toThrow(RangeError);
    expect(() => new SnowflakeGenerator(0)).not.toThrow();
    expect(() => new SnowflakeGenerator(1023)).not.toThrow();
  });

  it("ardışık çağrılarda çakışma üretmez", () => {
    const gen = new SnowflakeGenerator(1);
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i++) ids.add(gen.nextString());
    expect(ids.size).toBe(20_000);
  });

  it("monoton artar", () => {
    const gen = new SnowflakeGenerator(7);
    let previous = gen.next();
    for (let i = 0; i < 10_000; i++) {
      const current = gen.next();
      expect(current > previous).toBe(true);
      previous = current;
    }
  });

  it("farklı worker'lar aynı anda çakışmaz", () => {
    const a = new SnowflakeGenerator(1);
    const b = new SnowflakeGenerator(2);
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      ids.add(a.nextString());
      ids.add(b.nextString());
    }
    expect(ids.size).toBe(4000);
  });

  it("zaman damgası geri okunabilir", () => {
    const gen = new SnowflakeGenerator(3);
    const before = Date.now();
    const id = gen.next();
    const after = Date.now();
    const ts = snowflakeToDate(id).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("worker kimliği bitlere doğru yerleşir", () => {
    const gen = new SnowflakeGenerator(511);
    const id = gen.next();
    expect(Number((id >> 12n) & 1023n)).toBe(511);
  });

  it("üretilen ID 63 bite sığar (Postgres BIGINT işaretlidir)", () => {
    const gen = new SnowflakeGenerator(1023);
    expect(gen.next() < 1n << 63n).toBe(true);
  });
});

describe("snowflakeForTimestamp", () => {
  it("verilen andan sonra üretilen ID'lerden küçüktür", () => {
    const cursor = snowflakeForTimestamp(Date.now());
    const gen = new SnowflakeGenerator(1);
    expect(gen.next() >= cursor).toBe(true);
  });

  it("epoch başlangıcı sıfırdır", () => {
    expect(snowflakeForTimestamp(TUSCORD_EPOCH)).toBe(0n);
  });
});

describe("isSnowflake", () => {
  it("geçerli değerleri kabul eder", () => {
    expect(isSnowflake("0")).toBe(true);
    expect(isSnowflake(new SnowflakeGenerator(1).nextString())).toBe(true);
  });

  it("geçersiz değerleri reddeder", () => {
    for (const bad of ["", "abc", "-1", "1.5", " 12", "12 ", "9".repeat(21), 123, null, undefined, {}]) {
      expect(isSnowflake(bad)).toBe(false);
    }
  });
});
