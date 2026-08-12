/** Migration çalıştırıcı: `npm run db:migrate` */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './index.js';

// Yolu bu dosyanın konumuna göre çöz — çalışma dizininden bağımsız.
// Hem dev (src/db) hem prod imajı (dist/db) için `../../drizzle` doğru:
// ikisi de packages/server/drizzle'a çıkar. Sabit './drizzle' prod'da
// cwid=/app olduğu için yanlış yere bakıyordu.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

await migrate(db, { migrationsFolder });
console.log('Migration tamamlandı.');
await sql.end();
