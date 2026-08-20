import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { Errors } from './errors.js';

/** Kullanıcı adı + discriminator çifti benzersiz olmalı; boş dördül bulana kadar dene. */
export async function allocateDiscriminator(username: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = String(randomInt(1, 10_000)).padStart(4, '0');
    const existing = await db.query.users.findFirst({
      where: and(eq(users.username, username), eq(users.discriminator, candidate)),
    });
    if (!existing) return candidate;
  }
  throw Errors.conflict('username_taken', 'Bu kullanıcı adı dolu, başka bir tane dene');
}
