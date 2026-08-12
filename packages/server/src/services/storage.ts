/**
 * Nesne depolama — ekler ve avatarlar.
 *
 * İki uygulama, tek arayüz:
 *  - `LocalStorage`  geliştirme: dosyalar `var/uploads` altına yazılır
 *  - `R2Storage`     üretim: Cloudflare R2 (S3 uyumlu API, egress ücretsiz)
 *
 * Seçim ortam değişkenlerine bakar: R2 anahtarları doluysa R2, değilse yerel.
 * Böylece R2 hesabı olmadan da geliştirme yapılabiliyor ve üretime geçerken
 * kod değişmiyor.
 *
 * Nesne anahtarları **tahmin edilemez** olmalı (spec Bölüm 8): sıralı id
 * kullanmak, başkasının ekini deneyerek bulmayı mümkün kılar.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';

export interface StoredObject {
  /** Depolamadaki yol/anahtar. Veritabanında bu saklanır. */
  key: string;
  size: number;
  contentType: string;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** İstemcinin dosyayı indireceği URL. */
  publicUrl(key: string): string;
}

/**
 * Tahmin edilemez nesne anahtarı.
 * `<tür>/<yıl-ay>/<32 hex>.<uzantı>` — tarihe göre bölmek, ileride
 * saklama süresi dolan içeriği toplu silmeyi kolaylaştırır.
 */
export function generateObjectKey(prefix: 'attachments' | 'avatars', extension: string): string {
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${prefix}/${bucket}/${randomBytes(16).toString('hex')}.${extension}`;
}

/* ------------------------------------------------------------------ */
/* Yerel disk (geliştirme)                                             */
/* ------------------------------------------------------------------ */

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UPLOAD_ROOT = join(SERVER_ROOT, 'var', 'uploads');

export class LocalStorage implements Storage {
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // Zaten yok; silme işlemi başarılı sayılır.
    }
  }

  publicUrl(key: string): string {
    // Yerelde dosyalar API üzerinden sunulur (bkz. routes/attachments.ts).
    return `/api/v1/media/${key}`;
  }

  /**
   * Anahtarı disk yoluna çevirir ve yükleme kökünün dışına çıkmadığını
   * doğrular. Anahtarlar bizim ürettiğimiz değerler ama bu kontrol,
   * ileride bir yerden dışarıdan anahtar gelirse diye duruyor.
   */
  private pathFor(key: string): string {
    const path = resolve(UPLOAD_ROOT, key);
    if (!path.startsWith(UPLOAD_ROOT)) {
      throw new Error(`Geçersiz nesne anahtarı: ${key}`);
    }
    return path;
  }
}

/* ------------------------------------------------------------------ */
/* Cloudflare R2 (üretim)                                              */
/* ------------------------------------------------------------------ */

/**
 * R2, S3 uyumlu API sunar. AWS SDK'sı ~15 MB bağımlılık getirdiği için
 * ihtiyacımız olan üç işlemi (PUT/GET/DELETE) SigV4 imzasıyla elle yapıyoruz.
 */
export class R2Storage implements Storage {
  constructor(
    private readonly accountId: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly bucket: string,
    private readonly publicBaseUrl: string | undefined,
  ) {}

  private get endpoint(): string {
    return `https://${this.accountId}.r2.cloudflarestorage.com`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const response = await this.signedFetch('PUT', key, body, contentType);
    if (!response.ok) {
      throw new Error(`R2 yükleme başarısız (${response.status}): ${await response.text()}`);
    }
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.signedFetch('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 okuma başarısız (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.signedFetch('DELETE', key);
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 silme başarısız (${response.status})`);
    }
  }

  publicUrl(key: string): string {
    // Herkese açık bir R2 alan adı tanımlıysa doğrudan oradan sunulur (CDN).
    // Yoksa API üzerinden vekil edilir.
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `/api/v1/media/${key}`;
  }

  /** AWS SigV4 imzalı istek. */
  private async signedFetch(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = new URL(`${this.endpoint}/${this.bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');

    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(Buffer.from(canonicalRequest)),
    ].join('\n');

    // İmza anahtarı zinciri: secret → tarih → bölge → servis → istek
    const kDate = hmac(Buffer.from(`AWS4${this.secretAccessKey}`), dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign).toString('hex');

    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, { method, headers, body });
  }
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/* ------------------------------------------------------------------ */

function createStorage(): Storage {
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return new R2Storage(
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_BUCKET,
      env.R2_PUBLIC_BASE_URL,
    );
  }

  // Üretimde R2 yoksa yerel diske düş — "en ucuz, tek sunucu" dağıtımı için
  // geçerli bir seçenek (~100 kullanıcı). ANCAK yükleme dizini kalıcı bir
  // Docker volume'e bağlanmalı, yoksa konteyner yeniden başlayınca dosyalar
  // uçar (bkz. docker/compose.prod.yml api → uploads volume).
  //
  // Uyarı burada değil, kullanan tarafta (routes/attachments.ts açılışta
  // usingLocalStorage ise loglar) — çift log olmasın.
  return new LocalStorage();
}

export const storage: Storage = createStorage();
export const usingLocalStorage = storage instanceof LocalStorage;
