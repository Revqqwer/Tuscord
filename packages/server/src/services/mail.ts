/**
 * E-posta gönderimi.
 *
 * Faz 1'de yalnızca işlemsel e-posta var: doğrulama ve parola sıfırlama.
 *
 * Sağlayıcı: Amazon SES SMTP (Brevo'dan taşındı). Alan adı doğrulaması
 * yapılmış bir sağlayıcı + SPF/DKIM/DMARC kaydı zorunlu — aksi halde
 * üretimde spam klasörüne düşer.
 *
 * SMTP yapılandırılmadıysa (geliştirme) mesaj konsola yazılır. Üretimde
 * SMTP_HOST zorunlu; env.ts bunu ayrıca kontrol etmez, ilk gönderim patlar
 * ve hata loglanır — kayıt akışı yine de tamamlanır (bkz. routes/auth.ts,
 * sendMail çağrıları .catch ile sarılı).
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '../env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Taşıyıcı bir kez kurulur (bağlantı havuzu). Her e-postada yeni bağlantı
 * açmak sağlayıcı tarafında hız sınırına takılır ve gecikme ekler.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 doğrudan TLS; 587 STARTTLS ile yükseltir (SES varsayılanı 587).
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    pool: true,
    maxConnections: 3,
  });

  return transporter;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const client = getTransporter();

  if (!client) {
    if (isProduction) {
      throw new Error('Üretimde SMTP_HOST zorunlu — doğrulama e-postaları gönderilemez');
    }
    // Geliştirme: bağlantıyı elle takip edebilmek için konsola yaz.
    console.log(
      `\n--- E-POSTA (geliştirme) ---\nKime: ${message.to}\nKonu: ${message.subject}\n\n${message.text}\n---\n`,
    );
    return;
  }

  await client.sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

/** Başlangıçta çağrılırsa SMTP kimlik bilgilerini erkenden doğrular. */
export async function verifyMailConnection(): Promise<boolean> {
  const client = getTransporter();
  if (!client) return false;
  try {
    await client.verify();
    return true;
  } catch (error) {
    console.error('[mail] SMTP doğrulaması başarısız', error);
    return false;
  }
}

/**
 * İki işlemsel e-posta da aynı minimal iskeleti kullanır: logo + başlık +
 * kısa metin + tek düğme. Uzun tutmuyoruz — kullanıcı tek bakışta ne
 * yapması gerektiğini görsün (bkz. kullanıcı isteği: "fazla uzun olmasın").
 * Satır içi CSS zorunlu: e-posta istemcilerinin çoğu <style> etiketini
 * (ve dış stil sayfalarını) yok sayar.
 */
function emailShell(options: { heading: string; body: string; buttonLabel: string; buttonUrl: string; footnote: string }): string {
  const logoUrl = `${env.WEB_ORIGIN}/email-logo.png`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:32px 16px;background:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;background:#151517;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:32px 32px 8px;">
                <img src="${logoUrl}" width="56" height="56" alt="Tuscord" style="display:block;border-radius:14px;" />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 0;">
                <h1 style="margin:0;font-size:18px;color:#f5f5f5;">${options.heading}</h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 32px 0;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:#a3a3a3;">${options.body}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px 8px;">
                <a href="${options.buttonUrl}" style="display:inline-block;padding:11px 28px;background:#14b8a6;color:#0a0a0a;font-weight:600;font-size:14px;text-decoration:none;border-radius:8px;">${options.buttonLabel}</a>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 32px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b6b;">${options.footnote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Kayıt sonrası hesabı etkinleştirme (e-posta doğrulama). */
export function verificationMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Tuscord hesabını etkinleştir',
    text: `Merhaba,\n\nHesabını etkinleştirmek için bağlantıya tıkla:\n${link}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.\n\nTuscord`,
    html: emailShell({
      heading: 'Hesabını etkinleştir',
      body: 'Tuscord\'a hoş geldin! Hesabını etkinleştirmek için aşağıdaki düğmeye tıklaman yeterli.',
      buttonLabel: 'Hesabımı etkinleştir',
      buttonUrl: link,
      footnote: 'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.',
    }),
  };
}

/** Parola sıfırlama isteği. */
export function passwordResetMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Tuscord parolanı sıfırla',
    text: `Merhaba,\n\nParolanı sıfırlamak için bağlantıya tıkla:\n${link}\n\nBağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.\n\nTuscord`,
    html: emailShell({
      heading: 'Parolanı sıfırla',
      body: 'Hesabın için bir parola sıfırlama isteği aldık. Yeni parola belirlemek için aşağıdaki düğmeye tıkla.',
      buttonLabel: 'Parolamı sıfırla',
      buttonUrl: link,
      footnote: 'Bağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.',
    }),
  };
}
