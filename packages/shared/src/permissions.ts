/**
 * İzin sistemi — projenin en kritik parçası.
 *
 * KURAL: Sunucuda hiçbir yerde elle izin kontrolü yapılmaz. Her yetkilendirme
 * kararı computePermissions() üzerinden geçer. Elle `role.permissions & X`
 * yazmak, kanal overwrite'larını atlamak demektir ve Discord klonlarının
 * en sık patladığı yer burasıdır.
 */

import type { Snowflake } from './snowflake.js';

/* ------------------------------------------------------------------ */
/* Bitfield                                                            */
/* ------------------------------------------------------------------ */

/**
 * Bit konumları kalıcıdır — veritabanında BIGINT olarak saklanıyorlar.
 * Yeni izin EKLE, mevcut bir bitin anlamını ASLA değiştirme.
 */
export const Permission = {
  // Genel
  VIEW_CHANNEL: 1n << 0n,
  READ_MESSAGE_HISTORY: 1n << 1n,
  CREATE_INVITE: 1n << 2n,
  CHANGE_NICKNAME: 1n << 3n,

  // Mesajlaşma
  SEND_MESSAGES: 1n << 4n,
  EMBED_LINKS: 1n << 5n,
  ATTACH_FILES: 1n << 6n,
  ADD_REACTIONS: 1n << 7n,
  MENTION_EVERYONE: 1n << 8n,
  MANAGE_MESSAGES: 1n << 9n,

  // Yönetim
  /** Kanal adı/konu/kilit/yavaş mod gibi GENEL ayarlar + silme. */
  MANAGE_CHANNELS: 1n << 10n,
  /** Soldaki kanal listesinde kanalların/kategorilerin sırasını değiştirme. */
  REORDER_CHANNELS: 1n << 25n,
  CREATE_TEXT_CHANNELS: 1n << 26n,
  CREATE_VOICE_CHANNELS: 1n << 27n,
  /** Rol TANIMLARINI düzenleme (ad/renk/izin bitleri/kanal overwrite'ları, oluşturma, silme). */
  MANAGE_ROLES: 1n << 11n,
  MANAGE_NICKNAMES: 1n << 12n,
  MANAGE_GUILD: 1n << 13n,
  VIEW_AUDIT_LOG: 1n << 14n,
  /**
   * Mevcut rolleri üyelere atama/kaldırma — MANAGE_ROLES'ten AYRI: bir
   * kullanıcı rol dağıtabilsin diye rolün KENDİSİNİ (izinlerini, hangi
   * kanalları gördüğünü) düzenleyebilmesi gerekmez. Rol düzenleme daha
   * hassas bir yetki (yetki yükseltmenin klasik yolu) — yalnızca
   * MANAGE_ROLES'ü taşıyanlarda (tipik olarak Yönetici/ADMINISTRATOR) kalsın.
   */
  ASSIGN_ROLES: 1n << 28n,

  // Moderasyon
  KICK_MEMBERS: 1n << 15n,
  BAN_MEMBERS: 1n << 16n,
  MODERATE_MEMBERS: 1n << 17n, // timeout verme

  // Ses (Faz 2)
  CONNECT: 1n << 18n,
  SPEAK: 1n << 19n,
  MUTE_MEMBERS: 1n << 20n,
  DEAFEN_MEMBERS: 1n << 21n,
  MOVE_MEMBERS: 1n << 22n,
  VIDEO: 1n << 23n, // Faz 3

  // Her şeyi baypas eder
  ADMINISTRATOR: 1n << 24n,
} as const;

export type PermissionName = keyof typeof Permission;
export type PermissionBits = bigint;

export const ALL_PERMISSIONS: PermissionBits = Object.values(Permission).reduce(
  (acc, bit) => acc | bit,
  0n,
);

/** Yeni bir sunucuda @everyone rolünün varsayılan izinleri. */
export const DEFAULT_EVERYONE_PERMISSIONS: PermissionBits =
  Permission.VIEW_CHANNEL |
  Permission.READ_MESSAGE_HISTORY |
  Permission.SEND_MESSAGES |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.ADD_REACTIONS |
  Permission.CREATE_INVITE |
  Permission.CHANGE_NICKNAME |
  Permission.CONNECT |
  Permission.SPEAK;

/**
 * Timeout'taki (susturulmuş) bir üyenin kaybettiği izinler.
 * Kanalı görmeye ve geçmişi okumaya devam eder — Discord davranışı.
 */
const TIMEOUT_REVOKED: PermissionBits =
  Permission.SEND_MESSAGES |
  Permission.ADD_REACTIONS |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.EMBED_LINKS |
  Permission.ATTACH_FILES |
  Permission.MENTION_EVERYONE |
  Permission.CREATE_INVITE |
  Permission.CHANGE_NICKNAME |
  Permission.MANAGE_MESSAGES |
  Permission.MANAGE_CHANNELS |
  Permission.REORDER_CHANNELS |
  Permission.CREATE_TEXT_CHANNELS |
  Permission.CREATE_VOICE_CHANNELS |
  Permission.MANAGE_ROLES |
  Permission.MANAGE_GUILD |
  Permission.KICK_MEMBERS |
  Permission.BAN_MEMBERS |
  Permission.MODERATE_MEMBERS;

/**
 * İzinlerin arayüzde gösterileceği gruplar.
 *
 * 25 izni tek listede göstermek kullanılamaz bir ekran demek; Discord da
 * aynı sebeple gruplar. Sıra bilinçli: en sık değiştirilenler üstte.
 */
export const PERMISSION_GROUPS = [
  {
    id: 'general',
    permissions: [
      'VIEW_CHANNEL',
      'READ_MESSAGE_HISTORY',
      'CREATE_INVITE',
      'CHANGE_NICKNAME',
    ],
  },
  {
    id: 'messaging',
    permissions: [
      'SEND_MESSAGES',
      'EMBED_LINKS',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'MENTION_EVERYONE',
      'MANAGE_MESSAGES',
    ],
  },
  {
    id: 'moderation',
    permissions: ['KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_NICKNAMES'],
  },
  {
    id: 'channels',
    permissions: [
      'CREATE_TEXT_CHANNELS',
      'CREATE_VOICE_CHANNELS',
      'REORDER_CHANNELS',
      'MANAGE_CHANNELS',
    ],
  },
  {
    id: 'management',
    permissions: ['ASSIGN_ROLES', 'MANAGE_ROLES', 'MANAGE_GUILD', 'VIEW_AUDIT_LOG'],
  },
  {
    id: 'voice',
    permissions: ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'],
  },
  {
    id: 'danger',
    permissions: ['ADMINISTRATOR'],
  },
] as const satisfies ReadonlyArray<{ id: string; permissions: readonly PermissionName[] }>;

export function has(bits: PermissionBits, permission: PermissionBits): boolean {
  return (bits & permission) === permission;
}

export function hasAny(bits: PermissionBits, permissions: PermissionBits): boolean {
  return (bits & permissions) !== 0n;
}

/** İzin bitfield'ını insan okunur isimlere çevirir (denetim kaydı ve arayüz için). */
export function permissionNames(bits: PermissionBits): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter((name) =>
    has(bits, Permission[name]),
  );
}

export function permissionsFromNames(names: readonly PermissionName[]): PermissionBits {
  return names.reduce<PermissionBits>((acc, name) => acc | Permission[name], 0n);
}

/* ------------------------------------------------------------------ */
/* Girdi tipleri                                                       */
/* ------------------------------------------------------------------ */

export interface RoleLike {
  id: Snowflake;
  /** Hiyerarşide sıra. Büyük olan üstte. @everyone her zaman 0. */
  position: number;
  permissions: PermissionBits;
}

export interface MemberLike {
  userId: Snowflake;
  /** @everyone HARİÇ rol kimlikleri. */
  roleIds: readonly Snowflake[];
  /** Gelecekteki bir tarihse üye timeout'tadır. */
  timeoutUntil?: Date | null;
}

export interface GuildLike {
  id: Snowflake;
  ownerId: Snowflake;
  /** @everyone rolü. Discord'da id === guild.id; biz de aynı kuralı koruyoruz. */
  everyoneRole: RoleLike;
  /** @everyone dışındaki roller, id → rol. */
  roles: ReadonlyMap<Snowflake, RoleLike>;
}

export type OverwriteTargetType = 'role' | 'member';

export interface PermissionOverwriteLike {
  targetId: Snowflake;
  targetType: OverwriteTargetType;
  allow: PermissionBits;
  deny: PermissionBits;
}

export interface ChannelLike {
  id: Snowflake;
  overwrites: readonly PermissionOverwriteLike[];
}

/* ------------------------------------------------------------------ */
/* Çekirdek hesaplama                                                  */
/* ------------------------------------------------------------------ */

/**
 * Bir üyenin sunucu genelindeki temel izinleri — kanal overwrite'ları uygulanmadan.
 * Yalnızca sunucu düzeyi kontroller (MANAGE_GUILD, VIEW_AUDIT_LOG, BAN_MEMBERS…) için kullan.
 */
export function computeBasePermissions(guild: GuildLike, member: MemberLike): PermissionBits {
  // 1. Sunucu sahibi → her şey.
  if (member.userId === guild.ownerId) return ALL_PERMISSIONS;

  // 2. @everyone ile başla.
  let permissions = guild.everyoneRole.permissions;

  // 3. Üyenin rollerini OR'la.
  for (const roleId of member.roleIds) {
    const role = guild.roles.get(roleId);
    if (role) permissions |= role.permissions;
  }

  // 4. ADMINISTRATOR her şeyi açar.
  if (has(permissions, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;

  return permissions;
}

/**
 * Bir üyenin belirli bir kanaldaki nihai izinleri.
 *
 * Overwrite sırası Discord ile birebir aynı olmak zorunda:
 *   @everyone overwrite → rol deny'ları (toplu) → rol allow'ları (toplu) → üye overwrite'ı
 *
 * Rol deny'ları TEK SEFERDE toplanıp uygulanır; rol rol dolaşıp
 * `deny sonra allow` uygulamak yanlış sonuç verir (bir rolün allow'u
 * başka bir rolün deny'ını sırasıyla ezerdi).
 */
export function computePermissions(
  guild: GuildLike,
  member: MemberLike,
  channel?: ChannelLike | null,
): PermissionBits {
  const base = computeBasePermissions(guild, member);

  // Sahip ve administrator overwrite'lardan muaf.
  if (base === ALL_PERMISSIONS) {
    return applyTimeout(base, member, guild);
  }

  let permissions = base;

  if (channel) {
    // 5a. @everyone overwrite'ı (hedef id === guild.id).
    const everyoneOverwrite = channel.overwrites.find(
      (o) => o.targetType === 'role' && o.targetId === guild.everyoneRole.id,
    );
    if (everyoneOverwrite) {
      permissions &= ~everyoneOverwrite.deny;
      permissions |= everyoneOverwrite.allow;
    }

    // 5b + 5c. Üyenin rollerine ait overwrite'lar: önce tüm deny'lar, sonra tüm allow'lar.
    let roleAllow = 0n;
    let roleDeny = 0n;
    for (const overwrite of channel.overwrites) {
      if (overwrite.targetType !== 'role') continue;
      if (overwrite.targetId === guild.everyoneRole.id) continue;
      if (!member.roleIds.includes(overwrite.targetId)) continue;
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
    permissions &= ~roleDeny;
    permissions |= roleAllow;

    // 5d. Üyeye özel overwrite — en yüksek öncelik.
    const memberOverwrite = channel.overwrites.find(
      (o) => o.targetType === 'member' && o.targetId === member.userId,
    );
    if (memberOverwrite) {
      permissions &= ~memberOverwrite.deny;
      permissions |= memberOverwrite.allow;
    }
  }

  // VIEW_CHANNEL yoksa kanalda hiçbir şey yapılamaz — kalan izinler anlamsız.
  // Bunu burada sıfırlamak, çağıran tarafın tek tek kontrol etmeyi unutmasını önler.
  if (!has(permissions, Permission.VIEW_CHANNEL)) {
    return 0n;
  }

  return applyTimeout(permissions, member, guild);
}

/**
 * 6. Timeout.
 *
 * Sunucu sahibi muaf (zaten timeout'a alınamaz). ADMINISTRATOR muaf DEĞİL:
 * hiyerarşi kuralı gereği bir yönetici alt konumdaki bir yöneticiyi timeout'a
 * alabilir ve bu etkili olmalı.
 */
function applyTimeout(
  permissions: PermissionBits,
  member: MemberLike,
  guild: GuildLike,
): PermissionBits {
  if (member.userId === guild.ownerId) return permissions;
  if (!isTimedOut(member)) return permissions;
  return permissions & ~TIMEOUT_REVOKED;
}

export function isTimedOut(member: MemberLike, now: Date = new Date()): boolean {
  return member.timeoutUntil != null && member.timeoutUntil.getTime() > now.getTime();
}

/* ------------------------------------------------------------------ */
/* Rol hiyerarşisi                                                     */
/* ------------------------------------------------------------------ */

/**
 * Üyenin en yüksek rol konumu. Rolü olmayan üye @everyone seviyesindedir (0).
 * Sunucu sahibi için Infinity — hiyerarşinin dışındadır.
 */
export function highestRolePosition(guild: GuildLike, member: MemberLike): number {
  if (member.userId === guild.ownerId) return Number.POSITIVE_INFINITY;
  let highest = 0;
  for (const roleId of member.roleIds) {
    const role = guild.roles.get(roleId);
    if (role && role.position > highest) highest = role.position;
  }
  return highest;
}

/**
 * `actor`, `target` üyesini yönetebilir mi? (ban / kick / rol verme / takma ad)
 *
 * Kural: kendi en yüksek rolünden YÜKSEK veya EŞİT konumdaki bir rolü taşıyan
 * üye yönetilemez. Eşitlik de engeldir — aynı roldeki iki kişi birbirini atamaz.
 * Sunucu sahibi muaftır ve kimse tarafından yönetilemez.
 */
export function canManageMember(
  guild: GuildLike,
  actor: MemberLike,
  target: MemberLike,
): boolean {
  if (actor.userId === target.userId) return false;
  if (target.userId === guild.ownerId) return false;
  if (actor.userId === guild.ownerId) return true;
  return highestRolePosition(guild, actor) > highestRolePosition(guild, target);
}

/**
 * `actor`, bu rolü düzenleyebilir/atayabilir/silebilir mi?
 * Kendi en yüksek rolünden düşük konumdaki roller üzerinde yetkilidir.
 *
 * `requiredPermission` çağırana göre değişir: rol TANIMINI düzenlerken
 * MANAGE_ROLES (varsayılan), üyeye rol ATARKEN ASSIGN_ROLES — ikisi ayrı
 * yetkiler (bkz. permissions.ts ASSIGN_ROLES yorumu), ama pozisyon
 * hiyerarşisi kuralı (kendinden düşük role) HER İKİSİNDE de aynı.
 */
export function canManageRole(
  guild: GuildLike,
  actor: MemberLike,
  role: RoleLike,
  requiredPermission: PermissionBits = Permission.MANAGE_ROLES,
): boolean {
  if (actor.userId === guild.ownerId) return true;
  if (!has(computeBasePermissions(guild, actor), requiredPermission)) return false;
  return highestRolePosition(guild, actor) > role.position;
}
