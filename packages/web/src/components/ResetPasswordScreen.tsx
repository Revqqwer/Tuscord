/**
 * Parola sıfırlama e-postasındaki bağlantının indiği ekran
 * (`/parola-sifirla?token=...`, bkz. App.tsx). Sunucudaki
 * `POST /auth/reset-password` ucunu çağırır — token geçerliyse yeni parola
 * kaydedilir ve tüm cihazlardaki oturumlar düşer (bkz. auth.ts yorumu:
 * hesap ele geçirilmişse saldırganın oturumu da düşsün).
 */

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Limits } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { WalrusLoader } from './WalrusLoader';

interface Props {
  token: string;
  onDone: () => void;
}

export function ResetPasswordScreen({ token, onDone }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < Limits.PASSWORD_MIN) {
      setError(t('auth.fieldErrors.password_short', { min: Limits.PASSWORD_MIN }));
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'invalid_token'
          ? t('auth.resetInvalidToken')
          : t('auth.errors.unknown'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <div className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 shadow-xl">
        <div className="mb-4 flex justify-center">
          <WalrusLoader />
        </div>
        <h1 className="mb-1 text-center text-2xl font-semibold">{t('auth.resetTitle')}</h1>
        <p className="mb-6 text-center text-sm text-[var(--color-ink-muted)]">{t('app.name')}</p>

        {done ? (
          <>
            <p role="status" className="mb-4 text-center text-sm text-[var(--color-online)]">
              {t('auth.resetSuccess')}
            </p>
            <button
              type="button"
              onClick={onDone}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
            >
              {t('auth.backToLogin')}
            </button>
          </>
        ) : (
          <form noValidate onSubmit={submit}>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('auth.newPassword')}
              </span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 pr-11 text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
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
              {busy ? t('common.loading') : t('auth.resetSubmit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
