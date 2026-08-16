/**
 * Ekran paylaşımı sahnesi — ses kanalındayken aktif paylaşımları gösterir.
 *
 * İKİ MOD: normalde küçük bir şerit (ana içerik alanının üstünde, sohbetle
 * birlikte). Bir döşemeye tıklayınca TAM EKRAN moduna geçer — sohbet
 * tamamen gizlenir, o yayın alanı doldurur; sağ üstteki "Sohbet" düğmesi
 * geri döner. Bu geçişi ChatShell yönetir (bkz. `focusedPresenterId`):
 * sohbetin gizlenip gizlenmeyeceğine ChatShell karar veriyor çünkü sohbet
 * bu bileşenin DIŞINDA, kardeş bir eleman (bkz. kullanıcı raporu — eskiden
 * ikisi hep birlikte, bölünmüş görünüyordu).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ScreenShare } from 'lucide-react';
import { useStore } from '../store';

interface Props {
  focusedPresenterId: string | null;
  onFocus: (userId: string | null) => void;
}

export function VoiceStage({ focusedPresenterId, onFocus }: Props) {
  const { t } = useTranslation();
  const screenStreams = useStore((s) => s.screenStreams);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const voiceStates = useStore((s) => s.voiceStates);
  const myId = useStore((s) => s.user?.id);

  // userId → görünen ad (ses odalarının roster'ından).
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const roster of voiceStates.values()) {
      for (const p of roster.values()) map.set(p.user.id, p.user.displayName ?? p.user.username);
    }
    return map;
  }, [voiceStates]);

  // Odaklanılan kişi paylaşımı bıraktıysa (akış Map'ten silindiyse) otomatik
  // olarak şeride dön — kapanmış bir yayının tam ekranında takılı kalınmasın.
  useEffect(() => {
    if (focusedPresenterId && !screenStreams.has(focusedPresenterId)) onFocus(null);
  }, [focusedPresenterId, screenStreams, onFocus]);

  if (!voiceChannelId || screenStreams.size === 0) return null;

  const tiles = [...screenStreams.entries()];

  if (focusedPresenterId) {
    const stream = screenStreams.get(focusedPresenterId);
    if (stream) {
      return (
        <FocusedStage
          stream={stream}
          label={focusedPresenterId === myId ? t('voice.you') : (names.get(focusedPresenterId) ?? t('dm.unknown'))}
          muted={focusedPresenterId === myId}
          onExit={() => onFocus(null)}
        />
      );
    }
  }

  return (
    <div className="shrink-0 border-b border-[var(--color-line)] bg-black/40 p-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        <ScreenShare size={12} /> {t('voice.screens', { count: tiles.length })}
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 2)}, minmax(0, 1fr))` }}
      >
        {tiles.map(([userId, stream]) => (
          <ScreenTile
            key={userId}
            stream={stream}
            label={userId === myId ? t('voice.you') : (names.get(userId) ?? t('dm.unknown'))}
            muted={userId === myId}
            onClick={() => onFocus(userId)}
          />
        ))}
      </div>
    </div>
  );
}

function ScreenTile({
  stream,
  label,
  muted,
  onClick,
}: {
  stream: MediaStream;
  label: string;
  muted: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg bg-black text-left"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="max-h-[42vh] w-full bg-black object-contain"
      />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
        <span className="truncate text-xs font-medium text-white">{label}</span>
      </div>
    </button>
  );
}

/** Tam ekran moddaki tek yayın — sohbetin yerini alır (bkz. dosya yorumu). */
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
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] shadow-lg hover:bg-[var(--color-surface-3)]"
      >
        <MessageSquare size={16} /> {t('voice.chat')}
      </button>
    </div>
  );
}
