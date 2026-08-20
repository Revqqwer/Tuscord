/**
 * Mesaj metnindeki bağlantılardan gömülü önizleme (embed) çıkarımı.
 *
 * Genel bir "link unfurl" servisi (rastgele sayfalardan OG etiketi kazımak)
 * KASITLI OLARAK yok — sunucu tarafında rastgele URL'lere istek atmak SSRF
 * riski taşır ve büyük bir ayrı özellik. Bunun yerine yalnızca güvenli,
 * istemci taraflı iki tip tanınır: doğrudan görsel/GIF bağlantıları ve
 * YouTube video bağlantıları (resmi, CORS'a açık uçlar).
 */

import { parseMarkdown } from '@tuscord/shared';

const IMAGE_EXTENSIONS = /\.(gif|png|jpe?g|webp)(\?.*)?$/i;

export interface ImageEmbed {
  type: 'image';
  url: string;
}

export interface YouTubeEmbed {
  type: 'youtube';
  url: string;
  videoId: string;
}

export type LinkEmbed = ImageEmbed | YouTubeEmbed;

/** youtube.com/watch?v=, youtu.be/, youtube.com/shorts/ — hepsinden video id çıkarır. */
function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return id ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    const shorts = parsed.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts?.[1]) return shorts[1];
  }
  return null;
}

/**
 * Mesaj metnindeki tüm bağlantıları (markdown parser'ın zaten ayırt ettiği
 * `link` düğümlerinden — kod bloğu içindekiler otomatik hariç kalır) tarar,
 * tanınan tipte olanları embed'e çevirir. Aynı URL birden fazla geçerse tekilleşir.
 */
export function extractEmbeds(content: string): LinkEmbed[] {
  const urls = new Set<string>();
  collectLinkUrls(parseMarkdown(content), urls);

  const embeds: LinkEmbed[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;

    const videoId = youtubeVideoId(url);
    if (videoId) {
      embeds.push({ type: 'youtube', url, videoId });
      seen.add(url);
      continue;
    }

    if (IMAGE_EXTENSIONS.test(parsedPathname(url))) {
      embeds.push({ type: 'image', url });
      seen.add(url);
    }
  }
  return embeds;
}

function parsedPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// parseMarkdown'un dönüş tipini burada tekrar tanımlamamak için gevşek tipliyoruz.
function collectLinkUrls(nodes: readonly { type: string; url?: string; children?: unknown[] }[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'link' && typeof node.url === 'string') out.add(node.url);
    if (Array.isArray(node.children)) {
      collectLinkUrls(node.children as typeof nodes, out);
    }
  }
}
