import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Tek bir bağlantı havuzu. 300-1000 kullanıcı ölçeğinde 10 bağlantı fazlasıyla yeter;
 * Postgres'te her bağlantı bir süreçtir, havuzu büyütmek ücretsiz değildir.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // BIGINT'i JS number'a çevirme — snowflake'ler 53 biti aşar.
  types: {
    bigint: postgres.BigInt,
  },
});

export const db = drizzle(sql, { schema });
export type Database = typeof db;
export { schema };
