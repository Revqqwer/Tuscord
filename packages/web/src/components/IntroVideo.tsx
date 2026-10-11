/**
 * Açılış sayfasındaki tanıtım videosu (public/tuscord-intro.mp4, 15 sn).
 *
 * Önce sesli oynatmayı dener; tarayıcı engellerse sessiz başlar ve
 * kullanıcının ilk tıklama/tuş/dokunuşunda sesi açar. Döngüde kalır.
 * Sağ altta ses aç/kapat düğmesi var.
 */

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export function IntroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // Önce SESLİ oynatmayı dene (kullanıcı siteyle daha önce etkileşmişse,
  // tarayıcı "medya etkileşimi" puanı yüksekse izin verir). Engellenirse sessiz
  // başlat ve ilk tıklama/tuş/dokunuşta sesi aç — tarayıcılar sesli otomatik
  // oynatmayı kullanıcı hareketi olmadan hiçbir şekilde izin vermez.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;

    const unmuteOnGesture = (): void => {
      if (cancelled) return;
      video.muted = false;
      setMuted(false);
      if (video.paused) void video.play().catch(() => undefined);
      cleanupGesture();
    };
    const gestureEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    const cleanupGesture = (): void => {
      for (const e of gestureEvents) window.removeEventListener(e, unmuteOnGesture);
    };

    async function start(): Promise<void> {
      video!.muted = false;
      try {
        await video!.play();
        if (!cancelled) setMuted(false);
      } catch {
        // Sesli oynatma engellendi → sessiz başlat, ilk harekette sesi aç.
        video!.muted = true;
        setMuted(true);
        void video!.play().catch(() => undefined);
        for (const e of gestureEvents) window.addEventListener(e, unmuteOnGesture, { once: true });
      }
    }
    void start();

    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && video.paused) void video.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      cleanupGesture();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  function toggleSound(): void {
    const video = ref.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    // Ses açılırken bazı tarayıcılar oynatmayı durdurabilir — devam ettir.
    if (video.paused) void video.play().catch(() => undefined);
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
      <video
        ref={ref}
        src="/tuscord-intro.mp4"
        poster="/tuscord-intro-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label="Tuscord tanıtım videosu"
        className="block h-auto max-h-[26dvh] w-full bg-black object-contain sm:max-h-[34dvh] lg:max-h-[42dvh]"
      />
      <button
        type="button"
        onClick={toggleSound}
        aria-label={muted ? 'Sesi aç' : 'Sesi kapat'}
        title={muted ? 'Sesi aç' : 'Sesi kapat'}
        className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </div>
  );
}
