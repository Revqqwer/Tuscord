/**
 * Destek ekranı — iki farklı yerden açılır:
 *  1. Giriş yapmış kullanıcı, sağ üstteki destek düğmesiyle (bkz. ChatShell.tsx).
 *  2. Askıya alınmış bir hesap giriş yapmaya çalıştığında (bkz. AuthScreen.tsx
 *     onSuspended, App.tsx) — bu durumda giriş YAPILAMADIĞI için form
 *     OTURUMSUZ gönderilir (bkz. server routes/tickets.ts: POST /tickets
 *     requireAuth istemiyor).
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { WalrusLoader } from './WalrusLoader';

interface Props {
  initialEmail?: string;
  /** Askıya alınmış girişten geldiyse dolu — banner + hazır konu için. */
  suspendedUntil?: string;
  onClose: () => void;
}

export function SupportScreen({ initialEmail, suspendedUntil, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [subject, setSubject] = useState(suspendedUntil ? t('support.suspendedSubject') : '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNumber, setSentNumber] = useState<number | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ id: string; number: number }>('/tickets', {
        email,
        subject,
        message,
      });
      setSentNumber(result.number);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'rate_limited'
          ? t('message.tooFast')
          : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  }

  const untilText = suspendedUntil
    ? new Date(suspendedUntil).toLocaleString(i18n.language === 'tr' ? 'tr-TR' : 'en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('support.title')}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-lg bg-[var(--color-surface-1)] p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-3 top-3 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          <X size={18} />
        </button>

        <div className="mb-4 flex justify-center">
          <WalrusLoader />
        </div>
        <h1 className="mb-1 text-center text-2xl font-semibold">{t('support.title')}</h1>
        <p className="mb-6 text-center text-sm text-[var(--color-ink-muted)]">{t('app.name')}</p>

        {untilText && (
          <p className="mb-4 rounded bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
            {t('support.suspendedBanner', { until: untilText })}
          </p>
        )}

        {sentNumber !== null ? (
          <>
            <p role="status" className="mb-4 text-center text-sm text-[var(--color-online)]">
              {t('support.sent', { number: sentNumber })}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
            >
              {t('common.close')}
            </button>
          </>
        ) : (
          <form noValidate onSubmit={submit}>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('auth.email')}
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('support.subject')}
              </span>
              <input
                type="text"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('support.message')}
              </span>
              <textarea
                required
                rows={5}
                maxLength={4000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
              />
            </label>

            {error && (
              <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('support.send')}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {t('common.close')}
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-[var(--color-line)] pt-4 text-center text-xs text-[var(--color-ink-muted)]">
          <p className="mb-2">{t('support.orEmail')}</p>
          <div className="flex flex-col items-center gap-1">
            <a
              href="mailto:info@tuscord.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[var(--color-brand)] hover:underline"
            >
              <Mail size={13} /> info@tuscord.com
            </a>
            <a
              href="mailto:destek@tuscord.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[var(--color-brand)] hover:underline"
            >
              <Mail size={13} /> destek@tuscord.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
