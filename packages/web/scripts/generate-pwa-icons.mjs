/**
 * manifest.webmanifest için raster (PNG) ikonlar üretir.
 *
 * Chrome'un PWA kurulabilirlik kontrolü (beforeinstallprompt'un ateşlenmesi
 * için) SVG-only ikon setlerinde tutarsız çalışıyor — pratikte en az bir
 * 192x192 ve 512x512 PNG istiyor. icon.svg/icon-maskable.svg'den sharp ile
 * üretiyoruz (bkz. generate-og-image.mjs — aynı bağımlılık).
 *
 * Çalıştırma: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const jobs = [
  { svg: 'icon.svg', sizes: [192, 512], suffix: '' },
  { svg: 'icon-maskable.svg', sizes: [192, 512], suffix: '-maskable' },
];

for (const job of jobs) {
  const svgBuffer = readFileSync(path.join(publicDir, job.svg));
  for (const size of job.sizes) {
    const outPath = path.join(publicDir, `icon${job.suffix}-${size}.png`);
    await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(outPath);
    console.log('yazıldı:', outPath);
  }
}
