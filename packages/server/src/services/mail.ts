/**
 * E-posta gönderimi.
 *
 * Faz 1'de yalnızca işlemsel e-posta var: doğrulama ve parola sıfırlama.
 *
 * Sağlayıcı: Brevo (eski adıyla Sendinblue) SMTP. Gmail SMTP üretimde spam
 * klasörüne düşüyor; alan adı doğrulaması yapılmış bir sağlayıcı + SPF/DKIM/DMARC
 * kaydı zorunlu. Brevo'nun ücretsiz katmanı bu ölçek için fazlasıyla yeter.
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
}

/**
 * Taşıyıcı bir kez kurulur (bağlantı havuzu). Her e-postada yeni bağlantı
 * açmak Brevo tarafında hız sınırına takılır ve gecikme ekler.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 doğrudan TLS; 587 STARTTLS ile yükseltir (Brevo varsayılanı 587).
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

export function verificationMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Tuscord — e-posta adresini doğrula',
    text: `Merhaba,\n\nHesabını etkinleştirmek için bağlantıya tıkla:\n${link}\n\nBu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.\n\nTuscord`,
  };
}

export function passwordResetMail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Tuscord — parola sıfırlama',
    text: `Merhaba,\n\nParolanı sıfırlamak için bağlantıya tıkla:\n${link}\n\nBağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.\n\nTuscord`,
  };
}
