/**
 * API hataları. Tüm uçlar hata durumunda `APIError` gövdesi döner.
 *
 * `code` istemcinin çeviri anahtarıdır; `message` yalnızca geliştirici içindir.
 * Yetkilendirme hatalarında ayrıntı sızdırma: var olmayan kanal ile
 * görme izni olmayan kanal AYNI cevabı vermeli (404), yoksa gizli kanalların
 * varlığı sızar.
 */

export class APIException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'APIException';
  }
}

export const Errors = {
  badRequest: (code = 'bad_request', message = 'Geçersiz istek', fields?: Record<string, string>) =>
    new APIException(400, code, message, fields),

  validation: (fields: Record<string, string>) =>
    new APIException(400, 'validation_failed', 'Doğrulama hatası', fields),

  unauthorized: (code = 'unauthorized', message = 'Giriş yapmalısın') =>
    new APIException(401, code, message),

  forbidden: (code = 'missing_permissions', message = 'Bu işlem için yetkin yok') =>
    new APIException(403, code, message),

  /** Görme izni olmayan kaynaklar için de bunu kullan — varlık bilgisi sızdırma. */
  notFound: (code = 'not_found', message = 'Bulunamadı') => new APIException(404, code, message),

  conflict: (code: string, message: string) => new APIException(409, code, message),

  tooLarge: (message = 'Dosya çok büyük') => new APIException(413, 'payload_too_large', message),

  rateLimited: (retryAfter: number) =>
    Object.assign(new APIException(429, 'rate_limited', 'Çok hızlısın, biraz bekle'), {
      retryAfter,
    }),

  internal: (message = 'Sunucu hatası') => new APIException(500, 'internal_error', message),
} as const;
