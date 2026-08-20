/**
 * Sosyal medya paylaşım kartı (Open Graph / Twitter Card) görseli üretir.
 *
 * X/Twitter ve çoğu kart tarayıcısı SVG'yi og:image olarak KABUL ETMEZ,
 * raster (PNG) ister — bu yüzden icon.svg'deki mors çizimini elle burada
 * tekrarlayıp (aynı path'ler) 1200x630 bir kart olarak sharp ile PNG'ye
 * çeviriyoruz. Marka için gerçek bir illüstrasyon yok (bkz. Homepage.tsx
 * yorumu) — aynı vektör mors + kelime markası yeterli.
 *
 * Çalıştırma: node scripts/generate-og-image.mjs
 * (packages/desktop zaten sharp'a bağımlı, workspace kökünde hoisted.)
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f1115" />
  <circle cx="1040" cy="60" r="280" fill="#14b8a6" opacity="0.08" />
  <circle cx="80" cy="640" r="240" fill="#14b8a6" opacity="0.06" />

  <!-- Mors ikonu — icon.svg ile AYNI path'ler, 512x512'den 360x360'a ölçekli -->
  <g transform="translate(96, 135) scale(0.703125)">
    <rect width="512" height="512" rx="112" fill="#181c23" />
    <circle cx="256" cy="238" r="150" fill="#14b8a6" />
    <ellipse cx="256" cy="300" rx="92" ry="74" fill="#0d9488" />
    <circle cx="256" cy="286" r="26" fill="#181c23" />
    <circle cx="206" cy="222" r="20" fill="#181c23" />
    <circle cx="306" cy="222" r="20" fill="#181c23" />
    <circle cx="212" cy="216" r="7" fill="#e6e8ec" />
    <circle cx="312" cy="216" r="7" fill="#e6e8ec" />
    <path d="M232 322c-6 42-12 74-24 104-4 10-18 8-19-3-3-34 4-72 20-104z" fill="#f5f7fa" />
    <path d="M280 322c6 42 12 74 24 104 4 10 18 8 19-3 3-34-4-72-20-104z" fill="#f5f7fa" />
    <g stroke="#181c23" stroke-width="6" stroke-linecap="round" opacity="0.85">
      <line x1="214" y1="300" x2="150" y2="292" />
      <line x1="214" y1="312" x2="156" y2="320" />
      <line x1="298" y1="300" x2="362" y2="292" />
      <line x1="298" y1="312" x2="356" y2="320" />
    </g>
  </g>

  <text x="528" y="330" font-family="Arial, Helvetica, sans-serif" font-size="116" font-weight="800" fill="#e6e8ec">Tuscord</text>
  <text x="532" y="392" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#9aa2b1">Arkadaşlarınla sohbet etmenin en rahat yolu</text>
</svg>
`;

const outPath = path.join(__dirname, '..', 'public', 'og-image.png');
const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(outPath, buffer);
console.log(`Yazıldı: ${outPath} (${buffer.length} bayt)`);
