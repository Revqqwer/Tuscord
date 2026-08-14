/**
 * Veritabanı satırı → API DTO dönüşümleri.
 *
 * Tek kural: bigint'ler string olarak çıkar. Bunu tek yerde yapmak,
 * bir rotada unutulup istemciye number gitmesini (ve 53 bit üstünde
 * sessizce bozulmasını) engeller.
 */

import type {
  APIAttachment,
  APIChannel,
  APIGuild,
  APIGuildMember,
  APIMessage,
  APIReaction,
  APIRole,
  ChannelType,
  MessageType,
  PublicUser,
  SelfUser,
} from '@tuscord/shared';
import type { Attachment, Channel, Guild, Message, Role, User } from '../db/schema.js';
import type { SessionUser } from '../auth/session.js';
import { storage } from './storage.js';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id.toString(),
    username: user.username,
    discriminator: user.discriminator,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isBot: user.isBot,
  };
}

export function toSelfUser(user: SessionUser): SelfUser {
  return {
    id: user.id.toString(),
    username: user.username,
    discriminator: user.discriminator,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isBot: user.isBot,
    email: user.email,
    emailVerified: user.emailVerified,
    mfaEnabled: user.mfaEnabled,
    locale: user.locale,
    isAdmin: user.isAdmin,
  };
}

export function toAPIGuild(guild: Guild): APIGuild {
  return {
    id: guild.id.toString(),
    name: guild.name,
    iconUrl: guild.iconUrl,
    bannerUrl: guild.bannerUrl,
    ownerId: guild.ownerId.toString(),
    description: guild.description,
    systemChannelId: guild.systemChannelId?.toString() ?? null,
    createdAt: guild.createdAt.toISOString(),
  };
}

export function toAPIRole(role: Role): APIRole {
  return {
    id: role.id.toString(),
    guildId: role.guildId.toString(),
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions.toString(),
    hoist: role.hoist,
    mentionable: role.mentionable,
  };
}

export interface ChannelSerializeOptions {
  /** MANAGE_CHANNELS izni varsa overwrite'lar da gönderilir. */
  includeOverwrites?: ReadonlyArray<{ targetId: string; targetType: 'role' | 'member'; allow: bigint; deny: bigint }>;
  recipients?: PublicUser[];
}

export function toAPIChannel(channel: Channel, options: ChannelSerializeOptions = {}): APIChannel {
  const result: APIChannel = {
    id: channel.id.toString(),
    guildId: channel.guildId?.toString() ?? null,
    type: channel.type as ChannelType,
    name: channel.name,
    topic: channel.topic,
    position: channel.position,
    parentId: channel.parentId?.toString() ?? null,
    slowmodeSeconds: channel.slowmodeSeconds,
    nsfw: channel.nsfw,
    locked: channel.locked,
    lastMessageId: channel.lastMessageId?.toString() ?? null,
  };
  if (options.includeOverwrites) {
    result.overwrites = options.includeOverwrites.map((o) => ({
      targetId: o.targetId,
      targetType: o.targetType,
      allow: o.allow.toString(),
      deny: o.deny.toString(),
    }));
  }
  if (options.recipients) result.recipients = options.recipients;
  return result;
}

export function toAPIMember(
  member: { guildId: bigint; nickname: string | null; joinedAt: Date; timeoutUntil: Date | null },
  user: User,
  roleIds: bigint[],
): APIGuildMember {
  return {
    guildId: member.guildId.toString(),
    user: toPublicUser(user),
    nickname: member.nickname,
    roles: roleIds.map((r) => r.toString()),
    joinedAt: member.joinedAt.toISOString(),
    timeoutUntil: member.timeoutUntil?.toISOString() ?? null,
  };
}

export function toAPIAttachment(attachment: Attachment): APIAttachment {
  return {
    id: attachment.id.toString(),
    filename: attachment.filename,
    size: attachment.size,
    contentType: attachment.contentType,
    // Nesne anahtarı 128 bit rastgele; bağlantıyı bilen erişir.
    url: storage.publicUrl(attachment.objectKey),
    previewUrl: attachment.contentType.startsWith('image/')
      ? `/api/v1/media-inline/${attachment.objectKey}`
      : null,
    width: attachment.width,
    height: attachment.height,
  };
}

export interface MessageSerializeInput {
  message: Message;
  author: User;
  attachments?: Attachment[];
  /** emoji → { count, kullanıcılar } */
  reactions?: Array<{ emoji: string; count: number; me: boolean }>;
}

export function toAPIMessage(input: MessageSerializeInput): APIMessage {
  const { message, author } = input;
  return {
    id: message.id.toString(),
    channelId: message.channelId.toString(),
    guildId: message.guildId?.toString() ?? null,
    author: toPublicUser(author),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    replyToId: message.replyToId?.toString() ?? null,
    pinned: message.pinned,
    type: message.type as MessageType,
    attachments: (input.attachments ?? []).map(toAPIAttachment),
    reactions: (input.reactions ?? []) as APIReaction[],
    mentions: message.mentions,
    mentionRoles: message.mentionRoles,
    mentionEveryone: message.mentionEveryone,
  };
}
