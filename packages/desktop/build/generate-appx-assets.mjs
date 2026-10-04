/**
 * Microsoft Store (MSIX/AppX) paketi için kutucuk görselleri üretir:
 * build/appx/*.png (electron-builder bu adları otomatik alır).
 * Kaynak: web/public/icon.svg. Bir kerelik araç.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dirname, '..', '..', 'web', 'public', 'icon.svg'));
const out = join(__dirname, 'appx');
mkdirSync(out, { recursive: true });

const square = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

for (const [name, size] of [
  ['StoreLogo.png', 50],
  ['Square44x44Logo.png', 44],
  ['Square150x150Logo.png', 150],
]) {
  await sharp(await square(size)).toFile(join(out, name));
}

// Geniş kutucuk: ikon, uygulamanın koyu arka planında ortalanmış.
await sharp({ create: { width: 310, height: 150, channels: 4, background: '#0f1115' } })
  .composite([{ input: await square(120), gravity: 'center' }])
  .png()
  .toFile(join(out, 'Wide310x150Logo.png'));

console.log('appx görselleri yazıldı:', out);
