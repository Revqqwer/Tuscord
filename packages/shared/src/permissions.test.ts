import { describe, it, expect } from 'vitest';
import {
  Permission,
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  computeBasePermissions,
  computePermissions,
  canManageMember,
  canManageRole,
  highestRolePosition,
  has,
  permissionNames,
  permissionsFromNames,
  isTimedOut,
  type GuildLike,
  type RoleLike,
  type MemberLike,
  type ChannelLike,
  type PermissionOverwriteLike,
  type PermissionName,
} from './permissions.js';

const GUILD_ID = '100';
const OWNER_ID = '1';
const ALICE = '2';
const BOB = '3';

function role(id: string, position: number, permissions: bigint): RoleLike {
  return { id, position, permissions };
}

function guild(
  opts: { everyone?: bigint; roles?: RoleLike[]; ownerId?: string } = {},
): GuildLike {
  return {
    id: GUILD_ID,
    ownerId: opts.ownerId ?? OWNER_ID,
    everyoneRole: role(GUILD_ID, 0, opts.everyone ?? DEFAULT_EVERYONE_PERMISSIONS),
    roles: new Map((opts.roles ?? []).map((r) => [r.id, r])),
  };
}

function member(userId: string, roleIds: string[] = [], timeoutUntil?: Date | null): MemberLike {
  return { userId, roleIds, timeoutUntil: timeoutUntil ?? null };
}

function channel(overwrites: PermissionOverwriteLike[] = []): ChannelLike {
  return { id: '500', overwrites };
}

function ow(
  targetId: string,
  targetType: 'role' | 'member',
  allow: bigint,
  deny: bigint,
): PermissionOverwriteLike {
  return { targetId, targetType, allow, deny };
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

/* ------------------------------------------------------------------ */

describe("bitfield yardımcıları", () => {
  it("her iznin benzersiz bir biti vardır", () => {
    const bits = Object.values(Permission);
    expect(new Set(bits.map(String)).size).toBe(bits.length);
  });

  it("ALL_PERMISSIONS tüm bitleri içerir", () => {
    for (const bit of Object.values(Permission)) {
      expect(has(ALL_PERMISSIONS, bit)).toBe(true);
    }
  });

  it("has() çok bitli maskede TÜM bitleri arar", () => {
    const bits = Permission.SEND_MESSAGES;
    expect(has(bits, Permission.SEND_MESSAGES | Permission.ATTACH_FILES)).toBe(false);
  });

  it("isim dönüşümü gidiş-dönüş çalışır", () => {
    const names = permissionNames(Permission.BAN_MEMBERS | Permission.VIEW_CHANNEL);
    expect([...names].sort()).toEqual(["BAN_MEMBERS", "VIEW_CHANNEL"]);
    expect(permissionsFromNames(names)).toBe(Permission.BAN_MEMBERS | Permission.VIEW_CHANNEL);
  });
});

describe("1. sunucu sahibi", () => {
  it("her izne sahiptir, @everyone her şeyi reddetse bile", () => {
    const g = guild({ everyone: 0n });
    expect(computeBasePermissions(g, member(OWNER_ID))).toBe(ALL_PERMISSIONS);
  });

  it("kanal overwrite'larından etkilenmez", () => {
    const g = guild({ everyone: 0n });
    const c = channel([
      ow(GUILD_ID, "role", 0n, ALL_PERMISSIONS),
      ow(OWNER_ID, "member", 0n, ALL_PERMISSIONS),
    ]);
    expect(computePermissions(g, member(OWNER_ID), c)).toBe(ALL_PERMISSIONS);
  });
});

describe("2-3. @everyone ve rol birleşimi", () => {
  it("rolsüz üye yalnızca @everyone izinlerini alır", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL });
    expect(computeBasePermissions(g, member(ALICE))).toBe(Permission.VIEW_CHANNEL);
  });

  it("birden fazla rolün izinleri OR'lanır", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL,
      roles: [role("10", 1, Permission.SEND_MESSAGES), role("11", 2, Permission.ATTACH_FILES)],
    });
    expect(computeBasePermissions(g, member(ALICE, ["10", "11"]))).toBe(
      Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.ATTACH_FILES,
    );
  });

  it("bilinmeyen rol kimliği sessizce yok sayılır", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL });
    expect(computeBasePermissions(g, member(ALICE, ["yok"]))).toBe(Permission.VIEW_CHANNEL);
  });

  it("rol izni @everyone üzerine EKLENİR, onun yerine geçmez", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL,
      roles: [role("10", 1, Permission.BAN_MEMBERS)],
    });
    const result = computeBasePermissions(g, member(ALICE, ["10"]));
    expect(has(result, Permission.VIEW_CHANNEL)).toBe(true);
    expect(has(result, Permission.BAN_MEMBERS)).toBe(true);
  });
});

describe("4. ADMINISTRATOR", () => {
  it("bir rolden gelirse tüm izinleri açar", () => {
    const g = guild({ everyone: 0n, roles: [role("10", 1, Permission.ADMINISTRATOR)] });
    expect(computeBasePermissions(g, member(ALICE, ["10"]))).toBe(ALL_PERMISSIONS);
  });

  it("kanal overwrite'ını baypas eder", () => {
    const g = guild({ everyone: 0n, roles: [role("10", 1, Permission.ADMINISTRATOR)] });
    const c = channel([ow(ALICE, "member", 0n, ALL_PERMISSIONS)]);
    expect(computePermissions(g, member(ALICE, ["10"]), c)).toBe(ALL_PERMISSIONS);
  });

  it("@everyone üzerinde verilirse herkes yönetici olur", () => {
    const g = guild({ everyone: Permission.ADMINISTRATOR });
    expect(computeBasePermissions(g, member(ALICE))).toBe(ALL_PERMISSIONS);
  });
});

describe("5. kanal overwrite sırası", () => {
  it("5a. @everyone overwrite'ı önce deny sonra allow uygular", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES });
    const c = channel([ow(GUILD_ID, "role", Permission.ATTACH_FILES, Permission.SEND_MESSAGES)]);
    const result = computePermissions(g, member(ALICE), c);
    expect(has(result, Permission.SEND_MESSAGES)).toBe(false);
    expect(has(result, Permission.ATTACH_FILES)).toBe(true);
  });

  it("5b-5c. bir rolün allow'u başka bir rolün deny'ını yener", () => {
    // Discord davranışı: tüm rol deny'ları toplanıp uygulanır, SONRA tüm allow'lar.
    const g = guild({
      everyone: Permission.VIEW_CHANNEL,
      roles: [role("10", 1, 0n), role("11", 2, 0n)],
    });
    const c = channel([
      ow("10", "role", 0n, Permission.SEND_MESSAGES),
      ow("11", "role", Permission.SEND_MESSAGES, 0n),
    ]);
    expect(
      has(computePermissions(g, member(ALICE, ["10", "11"]), c), Permission.SEND_MESSAGES),
    ).toBe(true);
  });

  it("rol overwrite sonucu, dizideki sıradan bağımsızdır", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL,
      roles: [role("10", 1, 0n), role("11", 2, 0n)],
    });
    const forward = channel([
      ow("10", "role", 0n, Permission.SEND_MESSAGES),
      ow("11", "role", Permission.SEND_MESSAGES, 0n),
    ]);
    const reversed = channel([
      ow("11", "role", Permission.SEND_MESSAGES, 0n),
      ow("10", "role", 0n, Permission.SEND_MESSAGES),
    ]);
    const m = member(ALICE, ["10", "11"]);
    expect(computePermissions(g, m, forward)).toBe(computePermissions(g, m, reversed));
  });

  it("üyeye ait olmayan rolün overwrite'ı yok sayılır", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
      roles: [role("10", 1, 0n)],
    });
    const c = channel([ow("10", "role", 0n, Permission.SEND_MESSAGES)]);
    expect(has(computePermissions(g, member(ALICE, []), c), Permission.SEND_MESSAGES)).toBe(true);
  });

  it("5d. üye overwrite'ı rol overwrite'ını ezer", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL, roles: [role("10", 1, 0n)] });
    const c = channel([
      ow("10", "role", Permission.SEND_MESSAGES, 0n),
      ow(ALICE, "member", 0n, Permission.SEND_MESSAGES),
    ]);
    expect(has(computePermissions(g, member(ALICE, ["10"]), c), Permission.SEND_MESSAGES)).toBe(
      false,
    );
  });

  it("üye allow'u, rol deny'ını geri açar", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
      roles: [role("10", 1, 0n)],
    });
    const c = channel([
      ow("10", "role", 0n, Permission.SEND_MESSAGES),
      ow(ALICE, "member", Permission.SEND_MESSAGES, 0n),
    ]);
    expect(has(computePermissions(g, member(ALICE, ["10"]), c), Permission.SEND_MESSAGES)).toBe(
      true,
    );
  });

  it("başka üyenin overwrite'ı bize uygulanmaz", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES });
    const c = channel([ow(BOB, "member", 0n, Permission.SEND_MESSAGES)]);
    expect(has(computePermissions(g, member(ALICE), c), Permission.SEND_MESSAGES)).toBe(true);
  });

  it("kanal verilmezse yalnızca temel izinler döner", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES });
    expect(computePermissions(g, member(ALICE), null)).toBe(
      Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
    );
  });
});

describe("VIEW_CHANNEL kapısı", () => {
  it("VIEW_CHANNEL yoksa diğer tüm izinler düşer", () => {
    const g = guild({
      everyone:
        Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.MANAGE_MESSAGES,
    });
    const c = channel([ow(GUILD_ID, "role", 0n, Permission.VIEW_CHANNEL)]);
    expect(computePermissions(g, member(ALICE), c)).toBe(0n);
  });

  it("gizli kanal, üye overwrite'ı ile tek kişiye açılabilir", () => {
    const g = guild({ everyone: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES });
    const c = channel([
      ow(GUILD_ID, "role", 0n, Permission.VIEW_CHANNEL),
      ow(ALICE, "member", Permission.VIEW_CHANNEL, 0n),
    ]);
    expect(has(computePermissions(g, member(ALICE), c), Permission.VIEW_CHANNEL)).toBe(true);
    expect(computePermissions(g, member(BOB), c)).toBe(0n);
  });
});

describe("6. timeout", () => {
  it("geçmiş tarihli timeout etkisizdir", () => {
    const g = guild();
    const m = member(ALICE, [], past());
    expect(isTimedOut(m)).toBe(false);
    expect(has(computePermissions(g, m, channel()), Permission.SEND_MESSAGES)).toBe(true);
  });

  it("aktif timeout yazma/tepki/ses izinlerini kaldırır", () => {
    const g = guild();
    const result = computePermissions(g, member(ALICE, [], future()), channel());
    expect(has(result, Permission.SEND_MESSAGES)).toBe(false);
    expect(has(result, Permission.ADD_REACTIONS)).toBe(false);
    expect(has(result, Permission.SPEAK)).toBe(false);
  });

  it("aktif timeout kanalı görmeyi ve geçmişi okumayı engellemez", () => {
    const g = guild();
    const result = computePermissions(g, member(ALICE, [], future()), channel());
    expect(has(result, Permission.VIEW_CHANNEL)).toBe(true);
    expect(has(result, Permission.READ_MESSAGE_HISTORY)).toBe(true);
  });

  it("ADMINISTRATOR timeout'u baypas ETMEZ", () => {
    const g = guild({ roles: [role("10", 1, Permission.ADMINISTRATOR)] });
    const result = computePermissions(g, member(ALICE, ["10"], future()), channel());
    expect(has(result, Permission.SEND_MESSAGES)).toBe(false);
    expect(has(result, Permission.VIEW_CHANNEL)).toBe(true);
  });

  it("sunucu sahibi timeout'tan muaftır", () => {
    const g = guild();
    expect(computePermissions(g, member(OWNER_ID, [], future()), channel())).toBe(ALL_PERMISSIONS);
  });

  it("kanalsız hesaplamada da timeout uygulanır", () => {
    const g = guild({ everyone: DEFAULT_EVERYONE_PERMISSIONS | Permission.BAN_MEMBERS });
    const result = computePermissions(g, member(ALICE, [], future()), null);
    expect(has(result, Permission.BAN_MEMBERS)).toBe(false);
  });
});

describe("rol hiyerarşisi", () => {
  const g = guild({ roles: [role("10", 1, 0n), role("20", 5, 0n), role("30", 5, 0n)] });

  it("en yüksek konum doğru bulunur", () => {
    expect(highestRolePosition(g, member(ALICE, ["10", "20"]))).toBe(5);
    expect(highestRolePosition(g, member(ALICE, []))).toBe(0);
    expect(highestRolePosition(g, member(OWNER_ID, []))).toBe(Number.POSITIVE_INFINITY);
  });

  it("yüksek rol, düşük rolü yönetebilir", () => {
    expect(canManageMember(g, member(ALICE, ["20"]), member(BOB, ["10"]))).toBe(true);
  });

  it("EŞİT konumdaki rolü yönetemez", () => {
    expect(canManageMember(g, member(ALICE, ["20"]), member(BOB, ["30"]))).toBe(false);
  });

  it("düşük rol, yüksek rolü yönetemez", () => {
    expect(canManageMember(g, member(ALICE, ["10"]), member(BOB, ["20"]))).toBe(false);
  });

  it("kimse kendini yönetemez", () => {
    expect(canManageMember(g, member(ALICE, ["20"]), member(ALICE, ["20"]))).toBe(false);
  });

  it("sunucu sahibi herkesi yönetir", () => {
    expect(canManageMember(g, member(OWNER_ID), member(BOB, ["20"]))).toBe(true);
  });

  it("sunucu sahibi kimse tarafından yönetilemez", () => {
    const admin = guild({ roles: [role("99", 100, Permission.ADMINISTRATOR)] });
    expect(canManageMember(admin, member(ALICE, ["99"]), member(OWNER_ID))).toBe(false);
  });

  it("canManageRole: MANAGE_ROLES olmadan olmaz", () => {
    const g2 = guild({ everyone: 0n, roles: [role("10", 1, 0n), role("20", 5, 0n)] });
    expect(canManageRole(g2, member(ALICE, ["20"]), role("10", 1, 0n))).toBe(false);
  });

  it("canManageRole: kendi konumundan düşük rolü düzenleyebilir", () => {
    const g2 = guild({
      everyone: 0n,
      roles: [role("10", 1, 0n), role("20", 5, Permission.MANAGE_ROLES)],
    });
    expect(canManageRole(g2, member(ALICE, ["20"]), role("10", 1, 0n))).toBe(true);
  });

  it("canManageRole: kendi rolünü veya üstünü düzenleyemez", () => {
    const own = role("20", 5, Permission.MANAGE_ROLES);
    const g2 = guild({ everyone: 0n, roles: [own, role("30", 9, 0n)] });
    expect(canManageRole(g2, member(ALICE, ["20"]), own)).toBe(false);
    expect(canManageRole(g2, member(ALICE, ["20"]), role("30", 9, 0n))).toBe(false);
  });
});

describe("saflık", () => {
  const snapshot = (g: GuildLike, m: MemberLike, c: ChannelLike) =>
    JSON.stringify({
      everyone: g.everyoneRole.permissions.toString(),
      roles: [...g.roles.values()].map((r) => r.permissions.toString()),
      roleIds: m.roleIds,
      overwrites: c.overwrites.map((o) => [o.allow.toString(), o.deny.toString()]),
    });

  it("girdileri değiştirmez", () => {
    const g = guild({
      everyone: Permission.VIEW_CHANNEL,
      roles: [role("10", 1, Permission.SEND_MESSAGES)],
    });
    const m = member(ALICE, ["10"]);
    const c = channel([ow(GUILD_ID, "role", 0n, Permission.SEND_MESSAGES)]);
    const before = snapshot(g, m, c);
    computePermissions(g, m, c);
    computePermissions(g, m, c);
    expect(snapshot(g, m, c)).toBe(before);
  });

  it("aynı girdi için aynı sonucu verir", () => {
    const g = guild({ roles: [role("10", 1, Permission.MANAGE_MESSAGES)] });
    const m = member(ALICE, ["10"]);
    const c = channel([ow("10", "role", 0n, Permission.MANAGE_MESSAGES)]);
    expect(computePermissions(g, m, c)).toBe(computePermissions(g, m, c));
  });
});

describe("PERMISSION_GROUPS", () => {
  it("her izin TAM OLARAK BİR grupta görünür", () => {
    // Rol Ayarları ekranı yalnızca buradan okuyor: bir izin hiçbir grupta
    // yoksa arayüzde asla gösterilemez (rol atanamaz); iki grupta birden
    // varsa çift satır olarak görünür. İkisi de kopyala-yapıştır sırasında
    // olması kolay, sessiz hatalar.
    const allNames = Object.keys(Permission) as PermissionName[];
    const seen = new Map<PermissionName, string>();
    for (const group of PERMISSION_GROUPS) {
      for (const name of group.permissions) {
        expect(seen.has(name), `${name} zaten "${seen.get(name)}" grubunda`).toBe(false);
        seen.set(name, group.id);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...allNames].sort());
  });
});
