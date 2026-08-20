import { ChannelType, type APIChannel, type Snowflake } from '@tuscord/shared';

type ForcedVoiceChannelInfo = { name: string; guildId: Snowflake } | null;

/**
 * Bir moderatör MOVE_MEMBERS ile beni VIEW_CHANNEL'ım olmayan bir ses
 * kanalına taşıdıysa (bkz. voice.ts applyServerMove), o kanal
 * `guildChannels`'ta hiç yok — burada sentetik bir APIChannel kurulur ki
 * hem kanal listesinde (bkz. ChatShell.tsx ChannelList) hem ana panelde
 * (bkz. ChatShell.tsx üst seviye `channel` hesaplaması) diğer sesli
 * kanallardan görsel olarak farksız görünsün. Yalnızca sıralama/kanal-
 * ayarları gibi GERÇEK bir kanal kaydı gerektiren işlemler için kullanılamaz.
 */
export function buildForcedChannel(
  guildId: string,
  guildChannels: readonly APIChannel[],
  forcedVoiceChannelInfo: ForcedVoiceChannelInfo | null,
  voiceChannelId: string | null,
): APIChannel | null {
  if (
    !forcedVoiceChannelInfo ||
    forcedVoiceChannelInfo.guildId !== guildId ||
    !voiceChannelId ||
    guildChannels.some((c) => c.id === voiceChannelId)
  ) {
    return null;
  }
  return {
    id: voiceChannelId,
    guildId,
    type: ChannelType.GUILD_VOICE,
    name: forcedVoiceChannelInfo.name,
    topic: null,
    position: Number.MAX_SAFE_INTEGER,
    parentId: null,
    slowmodeSeconds: 0,
    nsfw: false,
    locked: false,
    lastMessageId: null,
    sticker: null,
  };
}
