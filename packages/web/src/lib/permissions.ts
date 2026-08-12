/**
 * İstemci tarafı izin hesabı — sunucudakiyle AYNI saf fonksiyon.
 *
 * Amacı yalnızca arayüz: yazamayacağın kanalda giriş kutusunu kapatmak,
 * yetkin olmayan menü öğesini gizlemek. Güvenlik sınırı değil; sunucu
 * her isteği yeniden doğrular.
 */

import {
  computePermissions,
  has,
  Permission,
  type ChannelLike,
  type GuildLike,
  type MemberLike,
  type PermissionBits,
} from '@tuscord/shared';
import type { GuildState } from '../store';
import type { APIChannel } from '@tuscord/shared';

function toGuildLike(state: GuildState): GuildLike {
  const everyone = state.roles.find((role) => role.id === state.guild.id);
  return {
    id: state.guild.id,
    ownerId: state.guild.ownerId,
    everyoneRole: {
      id: state.guild.id,
      position: 0,
      permissions: everyone ? BigInt(everyone.permissions) : 0n,
    },
    roles: new Map(
      state.roles
        .filter((role) => role.id !== state.guild.id)
        .map((role) => [
          role.id,
          { id: role.id, position: role.position, permissions: BigInt(role.permissions) },
        ]),
    ),
  };
}

function toMemberLike(state: GuildState): MemberLike {
  return {
    userId: state.member.user.id,
    roleIds: state.member.roles,
    timeoutUntil: state.member.timeoutUntil ? new Date(state.member.timeoutUntil) : null,
  };
}

function toChannelLike(channel: APIChannel): ChannelLike {
  return {
    id: channel.id,
    overwrites: (channel.overwrites ?? []).map((o) => ({
      targetId: o.targetId,
      targetType: o.targetType,
      allow: BigInt(o.allow),
      deny: BigInt(o.deny),
    })),
  };
}

export function channelPermissions(state: GuildState, channel: APIChannel): PermissionBits {
  return computePermissions(toGuildLike(state), toMemberLike(state), toChannelLike(channel));
}

export function guildPermissions(state: GuildState): PermissionBits {
  return BigInt(state.permissions);
}

export function can(bits: PermissionBits, permission: PermissionBits): boolean {
  return has(bits, permission);
}

export { Permission };
