import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelfUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { LegalFooter } from './LegalFooter';
import { WalrusLoader } from './WalrusLoader';

interface Props {
  onAuthenticated: (user: SelfUser) => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, username };
      const result = await api.post<{ user: SelfUser }>(path, body);
      onAuthenticated(result.user);
    } catch (caught) {
      // Sunucudan gelen `code` çeviri anahtarı; bilinmeyen kod genel mesaja düşer.
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      const key = `auth.errors.${code}`;
      const translated = t(key);
      setError(translated === key ? t('auth.errors.unknown') : translated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 shadow-xl"
      >
        <div className="mb-4 flex justify-center">
          <WalrusLoader />
        </div>
        <h1 className="mb-1 text-center text-2xl font-semibold">
          {mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-ink-muted)]">{t('app.name')}</p>

        {mode === 'register' && (
          <Field
            label={t('auth.username')}
            value={username}
            onChange={setUsername}
            autoComplete="username"
            required
          />
        )}
        <Field
          label={t('auth.email')}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />

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
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="mt-4 w-full text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {mode === 'login' ? t('auth.needAccount') : t('auth.haveAccount')}
        </button>

        <LegalFooter />
      </form>
    </div>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function Field({ label, value, onChange, type = 'text', ...rest }: FieldProps) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
      />
    </label>
  );
}
