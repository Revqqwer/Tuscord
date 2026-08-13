/**
 * Ekran paylaşımı sahnesi — ses kanalındayken aktif paylaşımları gösterir.
 *
 * Ana içerik alanının üstünde bir video şeridi olarak durur. Bir döşemeye
 * tıklamak onu tam ekran açar (tarayıcı Fullscreen API). Kendi paylaşımın
 * "Sen" etiketiyle ve sessiz (kendini duymamak için) gösterilir.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, ScreenShare } from 'lucide-react';
import { useStore } from '../store';

export function VoiceStage() {
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

  if (!voiceChannelId || screenStreams.size === 0) return null;

  const tiles = [...screenStreams.entries()];

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
          />
        ))}
      </div>
    </div>
  );
}

function ScreenTile({ stream, label, muted }: { stream: MediaStream; label: string; muted: boolean }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  function fullscreen() {
    void videoRef.current?.requestFullscreen?.();
  }

  return (
    <div
      className="group relative overflow-hidden rounded-lg bg-black"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
      {hover && (
        <button
          type="button"
          onClick={fullscreen}
          title={t('voice.fullscreen')}
          aria-label={t('voice.fullscreen')}
          className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
        >
          <Maximize2 size={14} />
        </button>
      )}
    </div>
  );
}
