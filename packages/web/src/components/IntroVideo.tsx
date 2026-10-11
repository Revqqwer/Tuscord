/**
 * Açılış sayfasındaki tanıtım videosu (public/tuscord-intro.mp4, 15 sn).
 *
 * Tarayıcılar sesli otomatik oynatmayı engeller; bu yüzden video SESSİZ ve
 * hemen oynamaya başlar (autoplay + muted + playsInline), döngüde kalır.
 * Sağ altta ses aç/kapat düğmesi var — kullanıcı tıklayınca ses gelir.
 */

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export function IntroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // React `muted` özniteliğini DOM'a güvenilir yazmaz → bazı tarayıcılar
  // otomatik oynatmayı engeller. Özelliği elle ayarlayıp oynatmayı açıkça
  // başlatıyoruz; sekme tekrar görünür olunca da (arka planda durmuş olabilir).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    const start = (): void => {
      if (video.paused && !video.dataset.userPaused) void video.play().catch(() => undefined);
    };
    start();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') start();
    };
    document.addEventListener('visibilitychange', onVisible);
    video.addEventListener('canplay', start);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      video.removeEventListener('canplay', start);
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
    <div className="relative order-first w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl lg:order-none lg:max-w-none lg:flex-1">
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
        className="block h-auto max-h-[26dvh] w-full bg-black object-contain sm:max-h-[34dvh] lg:max-h-[60dvh]"
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
