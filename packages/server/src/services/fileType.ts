/**
 * Dosya tipi doğrulama — **uzantıya değil, magic byte'a** bakar (spec Bölüm 8).
 *
 * Neden: `virus.exe` dosyasını `kedi.png` diye yüklemek uzantı kontrolünü
 * tamamen atlar. İçeriğin ilk baytları yalan söyleyemez.
 *
 * Beyaz liste yaklaşımı: tanımadığımız hiçbir tip kabul edilmez. Kara liste
 * tutmak, listeye girmeyen her yeni formatın açık kapı olması demek.
 */

export interface DetectedType {
  mime: string;
  extension: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'archive';
}

interface Signature extends DetectedType {
  /** Baytların dosya başından itibaren konumu. */
  offset: number;
  bytes: readonly number[];
  /** Ek doğrulama (ör. RIFF konteynerinde WEBP/WAV ayrımı). */
  verify?: (buffer: Buffer) => boolean;
}

const SIGNATURES: readonly Signature[] = [
  // --- Görseller ---
  {
    mime: 'image/png',
    extension: 'png',
    kind: 'image',
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: 'image/jpeg', extension: 'jpg', kind: 'image', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', extension: 'gif', kind: 'image', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  {
    mime: 'image/webp',
    extension: 'webp',
    kind: 'image',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46], // "RIFF"
    verify: (buffer) => buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { mime: 'image/bmp', extension: 'bmp', kind: 'image', offset: 0, bytes: [0x42, 0x4d] },

  // --- Video ---
  {
    mime: 'video/mp4',
    extension: 'mp4',
    kind: 'video',
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70], // "ftyp"
  },
  { mime: 'video/webm', extension: 'webm', kind: 'video', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },

  // --- Ses ---
  { mime: 'audio/mpeg', extension: 'mp3', kind: 'audio', offset: 0, bytes: [0x49, 0x44, 0x33] },
  { mime: 'audio/ogg', extension: 'ogg', kind: 'audio', offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] },
  {
    mime: 'audio/wav',
    extension: 'wav',
    kind: 'audio',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46],
    verify: (buffer) => buffer.subarray(8, 12).toString('ascii') === 'WAVE',
  },

  // --- Belgeler ---
  {
    mime: 'application/pdf',
    extension: 'pdf',
    kind: 'document',
    offset: 0,
    bytes: [0x25, 0x50, 0x44, 0x46],
  },

  // --- Arşivler ---
  // ZIP imzası docx/xlsx/pptx ile ortak; ayrıştırmıyoruz, hepsi arşiv sayılır.
  {
    mime: 'application/zip',
    extension: 'zip',
    kind: 'archive',
    offset: 0,
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
];

/** Magic byte kontrolü için okunması yeterli bayt sayısı. */
export const SIGNATURE_SAMPLE_SIZE = 16;

/**
 * İçeriğin gerçek tipini döner; tanınmayan tip için null.
 * Çağıran taraf null'ı reddetmeli — "bilinmiyorsa geçir" güvenlik açığıdır.
 */
export function detectFileType(buffer: Buffer): DetectedType | null {
  for (const signature of SIGNATURES) {
    const end = signature.offset + signature.bytes.length;
    if (buffer.length < end) continue;

    let matches = true;
    for (let i = 0; i < signature.bytes.length; i++) {
      if (buffer[signature.offset + i] !== signature.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (signature.verify && !signature.verify(buffer)) continue;

    return { mime: signature.mime, extension: signature.extension, kind: signature.kind };
  }
  return null;
}

/** SVG kasıtlı olarak desteklenmiyor: içine script gömülebilir (saklı XSS). */
export function isImage(type: DetectedType): boolean {
  return type.kind === 'image';
}

/**
 * Dosya adını güvenli hale getirir.
 *
 * Yol ayraçları temizlenir (`../../etc/passwd` adlı dosya yüklenebilir) ve
 * kontrol karakterleri atılır — bunlar dosya adına gizlenip log satırı veya
 * HTTP başlığı bölmeye yarar.
 */
export function sanitizeFilename(name: string): string {
  const withoutControlChars = [...name]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  // Yol ayracıyla böl ve yalnızca son parçayı al.
  // Ayraçları alt çizgiye çevirmek yetmez: `../../etc/passwd` → `_.._etc_passwd`
  // gibi `..` kalıntıları bırakırdı.
  const basename = withoutControlChars.split(/[/\\]/).pop() ?? '';

  const cleaned = basename
    // Baştaki noktalar: gizli dosya ve `..` denemesi.
    .replace(/^\.+/, '')
    .replace(/"/g, '')
    .trim();

  return cleaned.slice(0, 255) || 'dosya';
}
