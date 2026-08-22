/**
 * Doğrulama e-postasındaki bağlantının indiği ekran (`/dogrula?token=...`,
 * bkz. App.tsx + server auth.ts: `${WEB_ORIGIN}/dogrula?token=...`).
 * Sunucudaki `POST /auth/verify-email` ucunu mount olur olmaz otomatik
 * çağırır — kullanıcının bir şey yapmasına gerek yok, linke tıklaması yeterli.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { WalrusLoader } from './WalrusLoader';

interface Props {
  token: string;
  onLogin: () => void;
}

type Status = 'checking' | 'success' | 'error';

export function VerifyEmailScreen({ token, onLogin }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    void api
      .post('/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <div className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 text-center shadow-xl">
        <div className="mb-4 flex justify-center">
          <WalrusLoader />
        </div>
        <p className="mb-6 text-sm text-[var(--color-ink-muted)]">{t('app.name')}</p>

        {status === 'checking' && (
          <p className="text-sm text-[var(--color-ink-muted)]">{t('common.loading')}</p>
        )}

        {status === 'success' && (
          <>
            <h1 className="mb-2 text-xl font-semibold">{t('auth.verifySuccessTitle')}</h1>
            <p role="status" className="mb-6 text-sm text-[var(--color-online)]">
              {t('auth.verifySuccess')}
            </p>
            <button
              type="button"
              onClick={onLogin}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
            >
              {t('auth.login')}
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className="mb-2 text-xl font-semibold">{t('auth.verifyErrorTitle')}</h1>
            <p role="alert" className="mb-6 text-sm text-[var(--color-danger)]">
              {t('auth.verifyError')}
            </p>
            <button
              type="button"
              onClick={onLogin}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
            >
              {t('auth.backToLogin')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
