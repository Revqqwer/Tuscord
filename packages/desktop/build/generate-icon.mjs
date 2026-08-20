/**
 * icon.svg'den masaüstü uygulaması için çok çözünürlüklü .ico üretir.
 * Bir kerelik araç — build/icon.ico .gitignore'da (üretilen dosya).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '..', '..', 'web', 'public', 'icon.svg');
const outPath = join(__dirname, 'icon.ico');

const svg = readFileSync(svgPath);
const sizes = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()),
);

const ico = await pngToIco(pngBuffers);
writeFileSync(outPath, ico);
console.log('icon.ico yazıldı:', outPath, `(${sizes.join(', ')} px)`);
