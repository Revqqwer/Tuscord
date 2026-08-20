/**
 * Sesli kanal katılımcı görünümü — bir sesli kanala katılınca ortadaki
 * içerik alanının TAMAMINI kaplar (metin kanalı yerine, bkz. ChatShell.tsx:
 * `channel.type === ChannelType.GUILD_VOICE` iken bu bileşen gösterilir,
 * MessageList/Composer değil — kullanıcı raporu: "sesli kanala katılınca
 * ortadaki alanımızda metin kanalı yerine sesli kanalda bulunanlar
 * discorddaki gibi kutular halinde görünsün").
 *
 * İKİ MOD: normalde bir IZGARA — kanaldaki her katılımcı bir kutu (avatar +
 * ad + konuşma/susturma rozetleri; ekran paylaşıyorsa kutu video önizlemesi
 * olur). Bir yayına tıklayınca TAM EKRAN moduna geçer. Sağ üstte HER İKİ
 * modda da sabit bir "Sohbet" düğmesi var — bu artık VoiceControlBar'da
 * DEĞİL, doğrudan burada (bkz. kullanıcı raporu: "bu yeni açılan ekranın
 * sağ üstünde olsun chatleşme butonu") — o sesli kanala özel metin panelini
 * açar/kapar (bkz. VoiceChannelChatPanel.tsx). Tam ekrandan çıkmak AYRI bir
 * kontrol (sol üstte, "Izgaraya dön") — sohbet düğmesiyle karışmasın diye.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid2x2, Headphones, MessageSquare, MicOff, ScreenShare } from 'lucide-react';
import { useStore, type VoiceParticipant } from '../store';
import { Avatar } from './Avatar';

interface Props {
  channelId: string;
  focusedPresenterId: string | null;
  onFocus: (userId: string | null) => void;
}

export function VoiceStage({ channelId, focusedPresenterId, onFocus }: Props) {
  const { t } = useTranslation();
  const screenStreams = useStore((s) => s.screenStreams);
  const roster = useStore((s) => s.voiceStates.get(channelId));
  const speaking = useStore((s) => s.voiceSpeaking);
  const selfMuteGlobal = useStore((s) => s.selfMute);
  const selfDeafGlobal = useStore((s) => s.selfDeaf);
  const serverMutedUserIds = useStore((s) => s.serverMutedUserIds);
  const myId = useStore((s) => s.user?.id);
  const voiceChatOpen = useStore((s) => s.voiceChatOpen);
  const setVoiceChatOpen = useStore((s) => s.setVoiceChatOpen);
  const unreadCount = useStore((s) => s.readStates.get(channelId)?.unreadCount ?? 0);

  const participants = useMemo(() => (roster ? [...roster.values()] : []), [roster]);

  // Odaklanılan kişi paylaşımı bıraktıysa (akış Map'ten silindiyse) otomatik
  // olarak ızgaraya dön — kapanmış bir yayının tam ekranında takılı kalınmasın.
  useEffect(() => {
    if (focusedPresenterId && !screenStreams.has(focusedPresenterId)) onFocus(null);
  }, [focusedPresenterId, screenStreams, onFocus]);

  const focusedStream = focusedPresenterId ? screenStreams.get(focusedPresenterId) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-surface-0)]">
      {/* Sohbet düğmesi — ızgara VE tam ekran modunda da sabit görünür.
          Rozet: bu ses kanalının sohbetine mesaj geldiyse kaç tane olduğunu
          gösterir (bkz. kullanıcı isteği) — panel açıkken zaten okunmuş
          sayıldığı için (bkz. VoiceChannelChatPanel.tsx ack effect) orada
          hiç görünmez. */}
      <button
        type="button"
        onClick={() => setVoiceChatOpen(!voiceChatOpen)}
        className={`absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-lg transition ${
          voiceChatOpen
            ? 'bg-[var(--color-brand)] text-black'
            : 'bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-surface-3)]'
        }`}
      >
        <MessageSquare size={16} /> {voiceChatOpen ? t('voice.hideChat') : t('voice.chat')}
        {!voiceChatOpen && unreadCount > 0 && (
          <span className="rounded-full bg-[var(--color-dnd)] px-1.5 text-xs font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {focusedPresenterId && focusedStream ? (
        <FocusedStage
          stream={focusedStream}
          label={
            participants.find((p) => p.user.id === focusedPresenterId)?.user.displayName ??
            participants.find((p) => p.user.id === focusedPresenterId)?.user.username ??
            t('dm.unknown')
          }
          muted={focusedPresenterId === myId}
          onExit={() => onFocus(null)}
        />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 overflow-y-auto p-4">
          {participants.map((p) => {
            const isMe = p.user.id === myId;
            const stream = screenStreams.get(p.user.id);
            const muted = isMe ? selfMuteGlobal : p.selfMute;
            const deaf = isMe ? selfDeafGlobal : p.selfDeaf;
            const serverMuted = serverMutedUserIds.has(p.user.id);
            return (
              <ParticipantTile
                key={p.user.id}
                participant={p}
                label={p.user.displayName ?? p.user.username}
                isSpeaking={speaking.has(p.user.id)}
                muted={muted}
                deaf={deaf}
                serverMuted={serverMuted}
                stream={stream}
                streamMuted={isMe}
                onFocus={stream ? () => onFocus(p.user.id) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ParticipantTile({
  participant,
  label,
  isSpeaking,
  muted,
  deaf,
  serverMuted,
  stream,
  streamMuted,
  onFocus,
}: {
  participant: VoiceParticipant;
  label: string;
  isSpeaking: boolean;
  muted: boolean;
  deaf: boolean;
  serverMuted: boolean;
  stream?: MediaStream;
  streamMuted: boolean;
  onFocus?: () => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const Wrapper = onFocus ? 'button' : 'div';

  return (
    <Wrapper
      type={onFocus ? 'button' : undefined}
      onClick={onFocus}
      className={`relative flex min-h-[140px] flex-col items-center justify-center overflow-hidden rounded-xl bg-[var(--color-surface-2)] ${
        isSpeaking ? 'ring-2 ring-[var(--color-online)]' : ''
      } ${onFocus ? 'cursor-pointer text-left hover:brightness-110' : ''}`}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={streamMuted}
          className="h-full w-full bg-black object-contain"
        />
      ) : (
        <Avatar name={label} avatarUrl={participant.user.avatarUrl} size={64} />
      )}

      {stream && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-[var(--color-danger)]/85 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
          <ScreenShare size={10} /> {t('voice.live')}
        </span>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        <span className="flex shrink-0 items-center gap-1 text-white">
          {serverMuted && <MicOff size={13} className="text-[var(--color-danger)]" aria-label={t('voice.serverMuted')} />}
          {!serverMuted && deaf && <Headphones size={13} className="text-[var(--color-danger)]" />}
          {!serverMuted && !deaf && muted && <MicOff size={13} />}
        </span>
      </div>
    </Wrapper>
  );
}

/** Tam ekran moddaki tek yayın — ızgaranın yerini alır (bkz. dosya yorumu). */
function FocusedStage({
  stream,
  label,
  muted,
  onExit,
}: {
  stream: MediaStream;
  label: string;
  muted: boolean;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full max-h-full w-full object-contain" />
      <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-sm font-medium text-white">
        {label}
      </div>
      <button
        type="button"
        onClick={onExit}
        className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] shadow-lg hover:bg-[var(--color-surface-3)]"
      >
        <Grid2x2 size={16} /> {t('voice.backToGrid')}
      </button>
    </div>
  );
}
