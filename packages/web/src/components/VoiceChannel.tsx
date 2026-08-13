/**
 * Ses kanalı arayüzü:
 *  - VoiceChannelItem: kanal listesinde hoparlör + katıl/ayrıl + katılımcılar
 *  - VoiceControlBar: bağlıyken alt kullanıcı çubuğunun üstünde mute/deafen/ayrıl
 *
 * Konuşma göstergesi: aktif konuşanın avatarı yeşil halkayla çevrelenir.
 */

import { useTranslation } from 'react-i18next';
import {
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  ScreenShare,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { APIChannel } from '@tuscord/shared';
import { useStore } from '../store';
import { voice } from '../lib/voice';
import { Avatar } from './Avatar';

export function VoiceChannelItem({
  channel,
  onNavigate,
}: {
  channel: APIChannel;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const roster = useStore((s) => s.voiceStates.get(channel.id));
  const speaking = useStore((s) => s.voiceSpeaking);
  const selfMuteGlobal = useStore((s) => s.selfMute);
  const selfDeafGlobal = useStore((s) => s.selfDeaf);
  const myId = useStore((s) => s.user?.id);
  const connectedHere = voiceChannelId === channel.id;

  const participants = roster ? [...roster.values()] : [];

  async function join() {
    onNavigate();
    if (connectedHere) return;
    try {
      await voice.join(channel.id);
    } catch {
      // Mikrofon reddedildi vb. — kullanıcıya bileşen dışı bir uyarı gerekmez.
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void join()}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
          connectedHere
            ? 'text-[var(--color-ink)]'
            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
        }`}
      >
        <Volume2 size={14} className="shrink-0" />
        <span className="truncate">{channel.name}</span>
        {participants.length > 0 && (
          <span className="ml-auto text-xs text-[var(--color-ink-faint)]">{participants.length}</span>
        )}
      </button>

      {participants.length > 0 && (
        <div className="mb-1 ml-3 space-y-0.5 border-l border-[var(--color-line)] pl-2">
          {participants.map((p) => {
            const isMe = p.user.id === myId;
            const isSpeaking = speaking.has(p.user.id);
            // Kendi mute/deafen durumum store'dan; başkalarınınki roster'dan.
            const muted = isMe ? selfMuteGlobal : p.selfMute;
            const deaf = isMe ? selfDeafGlobal : p.selfDeaf;
            return (
              <div key={p.user.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                <span
                  className={`shrink-0 rounded-full ${
                    isSpeaking ? 'ring-2 ring-[var(--color-online)]' : 'ring-2 ring-transparent'
                  }`}
                >
                  <Avatar name={p.user.displayName ?? p.user.username} avatarUrl={p.user.avatarUrl} size={22} />
                </span>
                <span className="truncate text-[var(--color-ink-muted)]">
                  {p.user.displayName ?? p.user.username}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[var(--color-ink-faint)]">
                  {p.selfVideo ? (
                    <span className="flex items-center gap-0.5 rounded bg-[var(--color-danger)]/15 px-1 text-[9px] font-bold uppercase text-[var(--color-danger)]">
                      <ScreenShare size={10} /> {t('voice.live')}
                    </span>
                  ) : null}
                  {deaf ? <Headphones size={12} className="text-[var(--color-danger)]" /> : null}
                  {muted ? <MicOff size={12} className="text-[var(--color-danger)]" /> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Bağlıyken görünen alt kontrol çubuğu. */
export function VoiceControlBar() {
  const { t } = useTranslation();
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const connecting = useStore((s) => s.voiceConnecting);
  const selfMute = useStore((s) => s.selfMute);
  const selfDeaf = useStore((s) => s.selfDeaf);
  const selfSharing = useStore((s) => s.selfSharing);
  const guilds = useStore((s) => s.guilds);

  if (!voiceChannelId && !connecting) return null;

  // Bağlı olduğum ses kanalının adı + sunucusu.
  let channelName = '';
  let guildName = '';
  for (const g of guilds.values()) {
    const ch = g.channels.find((c) => c.id === voiceChannelId);
    if (ch) {
      channelName = ch.name ?? '';
      guildName = g.guild.name;
      break;
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-2">
      <div className="flex items-center gap-2 px-1">
        <Volume2 size={16} className="shrink-0 text-[var(--color-online)]" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-[var(--color-online)]">
            {connecting ? t('voice.connecting') : t('voice.connected')}
          </div>
          <div className="truncate text-xs text-[var(--color-ink-faint)]">
            {channelName} {guildName && `· ${guildName}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <ControlButton
          active={selfMute}
          label={selfMute ? t('voice.unmute') : t('voice.mute')}
          onClick={() => voice.setMute(!selfMute)}
        >
          {selfMute ? <MicOff size={16} /> : <Mic size={16} />}
        </ControlButton>
        <ControlButton
          active={selfDeaf}
          label={selfDeaf ? t('voice.undeafen') : t('voice.deafen')}
          onClick={() => voice.setDeaf(!selfDeaf)}
        >
          {selfDeaf ? <VolumeX size={16} /> : <Headphones size={16} />}
        </ControlButton>
        <ControlButton
          active={selfSharing}
          label={selfSharing ? t('voice.stopShare') : t('voice.share')}
          onClick={() => (selfSharing ? voice.stopScreenShare() : void voice.startScreenShare())}
        >
          {selfSharing ? <MonitorX size={16} /> : <MonitorUp size={16} />}
        </ControlButton>
        <button
          type="button"
          onClick={() => voice.leave()}
          title={t('voice.disconnect')}
          aria-label={t('voice.disconnect')}
          className="ml-auto flex items-center gap-1 rounded bg-[var(--color-danger)]/15 px-2 py-1.5 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25"
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex flex-1 items-center justify-center rounded px-2 py-1.5 transition ${
        active
          ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}
