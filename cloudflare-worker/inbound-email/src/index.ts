/**
 * info@tuscord.com / destek@tuscord.com adreslerine gelen mailleri Tuscord
 * destek talebi (ticket) sistemine aktarır — bkz. Cloudflare Email Routing
 * "Route to a Worker" hedefi. Sunucu tarafı:
 * packages/server/src/routes/tickets.ts POST /webhooks/inbound-email.
 *
 * Ham e-posta (message.raw) tam RFC822/MIME formatında — gövdeyi (özellikle
 * multipart/alternative + HTML-only mailler) elle ayrıştırmak yerine
 * postal-mime kullanıyoruz, Cloudflare'in kendi dokümantasyonunun önerdiği
 * kütüphane.
 */

import PostalMime from 'postal-mime';

export interface Env {
  INBOUND_EMAIL_SECRET: string;
  TICKET_WEBHOOK_URL: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);

    const text = parsed.text?.trim() || stripHtml(parsed.html ?? '') || '(gövde okunamadı)';
    // `message.from`, SMTP zarfının (Return-Path/MAIL FROM) adresi — GERÇEK
    // "From:" başlığı DEĞİL. Bounce-takip yapan sağlayıcılarda (ör. bizim
    // SES kurulumumuz) bu ikisi FARKLI olabilir; yanıt gönderenin gerçek
    // adresine gitsin diye ayrıştırılmış başlıktan alıyoruz, zarf yalnızca
    // header hiç yoksa (nadiren) yedek.
    const fromAddress = parsed.from?.address || message.from;

    const response = await fetch(env.TICKET_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': env.INBOUND_EMAIL_SECRET,
      },
      body: JSON.stringify({
        from: fromAddress,
        subject: parsed.subject ?? '',
        text: text.slice(0, 20_000),
      }),
    });

    // Sunucu 2xx dönmezse mail sessizce kaybolmasın — Cloudflare loglarında görünsün.
    if (!response.ok) {
      console.error('Ticket webhook başarısız', response.status, await response.text());
    }
  },
};

/** HTML-only mail (nadir ama olur) için kaba bir düz-metin çıkarımı. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
