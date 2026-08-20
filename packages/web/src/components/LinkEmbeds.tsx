/**
 * Mesaj metnindeki tanınan bağlantılar için gömülü önizleme:
 *  - Doğrudan görsel/GIF bağlantıları → satır içi görsel (GIF otomatik oynar,
 *    tıklayınca tam ekran önizleme).
 *  - YouTube bağlantıları → küçük resim + oynat düğmesi; tıklanınca sayfadan
 *    hiç ayrılmadan, önizlemenin yerinde video oynamaya başlar.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { extractEmbeds, type LinkEmbed } from '../lib/linkEmbeds';
import { ImageLightbox } from './ImageLightbox';

export function LinkEmbeds({ content }: { content: string }) {
  const embeds = extractEmbeds(content);
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null);

  if (embeds.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {embeds.map((embed) =>
        embed.type === 'image' ? (
          <button
            key={embed.url}
            type="button"
            onClick={() => setLightbox({ url: embed.url, filename: embed.url.split('/').pop() ?? 'gif' })}
            className="block"
          >
            <img
              src={embed.url}
              alt=""
              loading="lazy"
              className="max-h-80 max-w-full rounded border border-[var(--color-line)] object-contain"
            />
          </button>
        ) : (
          <YouTubeEmbed key={embed.url} embed={embed} />
        ),
      )}
      {lightbox && (
        <ImageLightbox url={lightbox.url} filename={lightbox.filename} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function YouTubeEmbed({ embed }: { embed: Extract<LinkEmbed, { type: 'youtube' }> }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    // YouTube'un resmi oEmbed ucu — CORS'a açık, anahtar gerektirmez.
    // Başarısız olursa yalnızca başlık gösterilmez, önizleme yine çalışır.
    const controller = new AbortController();
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(embed.url)}&format=json`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { title?: string } | null) => {
        if (data?.title) setTitle(data.title);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [embed.url]);

  if (playing) {
    return (
      <div className="aspect-video w-full max-w-md overflow-hidden rounded border border-[var(--color-line)]">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${embed.videoId}?autoplay=1`}
          title={title ?? 'YouTube'}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="group relative block w-full max-w-md overflow-hidden rounded border border-[var(--color-line)] bg-black"
      title={t('message.playVideo')}
    >
      <div className="aspect-video w-full">
        <img
          src={`https://img.youtube.com/vi/${embed.videoId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition group-hover:bg-black/40">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white transition group-hover:scale-110">
          <Play size={26} fill="currentColor" className="ml-1" />
        </span>
      </span>
      {title && (
        <span className="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-left text-sm text-white">
          {title}
        </span>
      )}
    </button>
  );
}
