/**
 * Geliştirme verisi: `npm run seed`
 *
 * İki kullanıcı, bir sunucu, birkaç kanal ve bir moderatör rolü oluşturur.
 * İzin sisteminin gerçek davranışını elle test edebilmek için rol
 * hiyerarşisi ve bir gizli kanal da kuruluyor.
 */

import { eq } from 'drizzle-orm';
import {
  ChannelType,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
} from '@tuscord/shared';
import { db, sql } from './index.js';
import {
  channels,
  guildMembers,
  guilds,
  memberRoles,
  permissionOverwrites,
  roles,
  users,
} from './schema.js';
import { hashPassword } from '../auth/password.js';
import { nextId } from '../lib/id.js';

const PASSWORD = 'tuscord123';

async function ensureUser(username: string, email: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return existing;

  const id = nextId();
  await db.insert(users).values({
    id,
    username,
    discriminator: String(Math.floor(Math.random() * 9000) + 1000),
    email,
    emailVerified: true,
    passwordHash: await hashPassword(PASSWORD),
    displayName: username,
  });
  const created = await db.query.users.findFirst({ where: eq(users.id, id) });
  return created!;
}

const owner = await ensureUser('hakan', 'hakan@tuscord.local');
const member = await ensureUser('deneme', 'deneme@tuscord.local');

const existingGuild = await db.query.guilds.findFirst({ where: eq(guilds.name, 'Tuscord Test') });
if (existingGuild) {
  console.log('Test sunucusu zaten var, atlanıyor.');
} else {
  const guildId = nextId();
  const categoryId = nextId();
  const generalId = nextId();
  const modChannelId = nextId();
  const modRoleId = nextId();

  await db.transaction(async (tx) => {
    await tx.insert(guilds).values({
      id: guildId,
      name: 'Tuscord Test',
      ownerId: owner.id,
      systemChannelId: generalId,
      description: 'Geliştirme sunucusu',
    });

    // @everyone: id === guild.id
    await tx.insert(roles).values([
      {
        id: guildId,
        guildId,
        name: '@everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
      },
      {
        id: modRoleId,
        guildId,
        name: 'Moderatör',
        position: 5,
        color: 0x14b8a6,
        hoist: true,
        permissions:
          DEFAULT_EVERYONE_PERMISSIONS |
          Permission.MANAGE_MESSAGES |
          Permission.KICK_MEMBERS |
          Permission.BAN_MEMBERS |
          Permission.MODERATE_MEMBERS |
          Permission.VIEW_AUDIT_LOG,
      },
    ]);

    await tx.insert(channels).values([
      { id: categoryId, guildId, type: ChannelType.GUILD_CATEGORY, name: 'metin kanalları', position: 0 },
      { id: generalId, guildId, type: ChannelType.GUILD_TEXT, name: 'genel', parentId: categoryId, position: 0 },
      { id: modChannelId, guildId, type: ChannelType.GUILD_TEXT, name: 'mod-log', parentId: categoryId, position: 1 },
    ]);

    // mod-log: @everyone göremez, yalnızca Moderatör rolü görür.
    // İzin motorunun gizli kanal davranışını elle doğrulamak için.
    await tx.insert(permissionOverwrites).values([
      {
        channelId: modChannelId,
        targetId: guildId,
        targetType: 'role',
        allow: 0n,
        deny: Permission.VIEW_CHANNEL,
      },
      {
        channelId: modChannelId,
        targetId: modRoleId,
        targetType: 'role',
        allow: Permission.VIEW_CHANNEL,
        deny: 0n,
      },
    ]);

    await tx.insert(guildMembers).values([
      { guildId, userId: owner.id },
      { guildId, userId: member.id },
    ]);
  });

  console.log(`Sunucu oluşturuldu: Tuscord Test (${guildId})`);
  console.log(`  #genel, #mod-log (gizli — yalnızca Moderatör rolü görür)`);
}

console.log('\nGiriş bilgileri:');
console.log(`  hakan@tuscord.local  / ${PASSWORD}   (sunucu sahibi)`);
console.log(`  deneme@tuscord.local / ${PASSWORD}   (normal üye)`);
console.log('\nModeratör rolünü elle atamak için üyeye rol verme ucunu kullan.');

await sql.end();
