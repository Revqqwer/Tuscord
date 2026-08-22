import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Limits, USERNAME_PATTERN, isStrongPassword, isValidEmail, type SelfUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { isDesktopApp } from '../lib/platform';
import { LegalFooter } from './LegalFooter';
import { WalrusLoader } from './WalrusLoader';

interface Props {
  onAuthenticated: (user: SelfUser) => void;
  /** Hesap askıya alınmışsa (bkz. server auth.ts login: suspendedUntil) genel
   * hata yerine destek ekranına yönlendirmek için — `until` ISO tarih. */
  onSuspended?: (email: string, until: string) => void;
}

type FieldName = 'username' | 'email' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Sunucunun `code` değerlerinden hangisi hangi alana ait?
 *
 * Buraya girmeyen kodlar (ör. `invalid_credentials`, `rate_limited`) form
 * geneline yazılır: e-posta mı parola mı yanlış olduğunu söylemek hesap
 * sayımına (enumeration) kapı açar — sunucu da bu yüzden ikisine aynı cevabı
 * veriyor.
 */
const CODE_TO_FIELD: Partial<Record<string, FieldName>> = {
  email_domain_invalid: 'email',
  username_taken: 'username',
};

/** Sunucunun alan bazlı doğrulama hatası için gösterilecek çeviri. */
const FIELD_MESSAGE_KEY: Record<FieldName, string> = {
  username: 'auth.fieldErrors.username_invalid',
  email: 'auth.fieldErrors.email_invalid',
  password: 'auth.fieldErrors.password_short',
};

export function AuthScreen({ onAuthenticated, onSuspended }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Masaüstü uygulamasında varsayılan işaretli — açılışta şifre sormadan
  // girmek zaten beklenen davranış (bkz. kullanıcı isteği: "logout olana
  // kadar tekrar şifre sormasın").
  const [remember, setRemember] = useState(() => isDesktopApp());

  /** Gönderimden önceki istemci kontrolü — sunucuya gitmeden alanda uyar. */
  function validate(): FieldErrors {
    const errors: FieldErrors = {};

    if (mode === 'register') {
      if (username.trim().length === 0) {
        errors.username = t('auth.fieldErrors.username_required');
      } else if (!USERNAME_PATTERN.test(username.trim().toLowerCase())) {
        errors.username = t('auth.fieldErrors.username_invalid', {
          min: Limits.USERNAME_MIN,
          max: Limits.USERNAME_MAX,
        });
      }
    }

    if (email.trim().length === 0) errors.email = t('auth.fieldErrors.email_required');
    else if (!isValidEmail(email)) errors.email = t('auth.fieldErrors.email_invalid');

    // Sıfırlama isteğinde parola alanı yok — yalnızca e-posta gerekir.
    if (mode === 'forgot') return errors;

    if (password.length === 0) {
      errors.password = t('auth.fieldErrors.password_required');
    } else if (mode === 'register' && password.length < Limits.PASSWORD_MIN) {
      // Girişte uzunluk kontrolü YOK: eski/kısa parolası olan kullanıcıyı
      // kendi hesabından kilitlemeyelim.
      errors.password = t('auth.fieldErrors.password_short', { min: Limits.PASSWORD_MIN });
    } else if (mode === 'register' && !isStrongPassword(password)) {
      errors.password = t('auth.fieldErrors.password_weak');
    }

    return errors;
  }

  /** Sunucu hatasını mümkünse ilgili alana, değilse form geneline yaz. */
  function showServerError(caught: unknown) {
    if (!(caught instanceof ApiError)) {
      setFormError(t('auth.errors.unknown'));
      return;
    }

    // Zod doğrulaması alan bazlı döner: { email: '...', password: '...' }.
    if (caught.fields && Object.keys(caught.fields).length > 0) {
      const mapped: FieldErrors = {};
      for (const [field, message] of Object.entries(caught.fields)) {
        if (field === 'username' || field === 'email' || field === 'password') {
          // Sunucu mesajları yalnızca Türkçe; kendi çevirimiz varsa onu
          // kullan, yoksa sunucununkine düş.
          const key = FIELD_MESSAGE_KEY[field as FieldName];
          const translated = t(key, {
            min: field === 'password' ? Limits.PASSWORD_MIN : Limits.USERNAME_MIN,
            max: Limits.USERNAME_MAX,
          });
          mapped[field] = translated === key ? message : translated;
        }
      }
      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
        return;
      }
    }

    const field = CODE_TO_FIELD[caught.code];
    const key = `auth.${field ? 'fieldErrors' : 'errors'}.${caught.code}`;
    const translated = t(key);
    const message = translated === key ? t('auth.errors.unknown') : translated;

    if (field) setFieldErrors({ [field]: message });
    else setFormError(message);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      if (mode === 'forgot') {
        // Hesap var mı yok mu belli olmasın diye sunucu her zaman 204 döner —
        // burada da her durumda "gönderildi" mesajı gösteriyoruz.
        await api.post('/auth/request-password-reset', { email });
        setResetSent(true);
        return;
      }
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login' ? { email, password, remember } : { email, password, username };
      const result = await api.post<{ user: SelfUser }>(path, body);
      onAuthenticated(result.user);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.code === 'account_suspended' &&
        caught.fields?.until &&
        onSuspended
      ) {
        onSuspended(email, caught.fields.until);
        return;
      }
      showServerError(caught);
    } finally {
      setBusy(false);
    }
  }

  /** Alan değişince o alanın hatasını temizle — düzeltirken kırmızı kalmasın. */
  function change(field: FieldName, value: string, setter: (v: string) => void) {
    setter(value);
    if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: undefined });
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <form
        noValidate
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 shadow-xl"
      >
        <div className="mb-4 flex justify-center">
          <WalrusLoader />
        </div>
        <h1 className="mb-1 text-center text-2xl font-semibold">
          {mode === 'login' ? t('auth.loginTitle') : mode === 'register' ? t('auth.registerTitle') : t('auth.resetRequestTitle')}
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-ink-muted)]">
          {mode === 'forgot' ? t('auth.resetRequestSubtitle') : t('app.name')}
        </p>

        {mode === 'forgot' && resetSent ? (
          <>
            <p role="status" className="mb-4 text-center text-sm text-[var(--color-online)]">
              {t('auth.resetRequestSent')}
            </p>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setResetSent(false);
              }}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
            >
              {t('auth.backToLogin')}
            </button>
          </>
        ) : (
          <>
            {mode === 'register' && (
              <Field
                label={t('auth.username')}
                value={username}
                error={fieldErrors.username}
                onChange={(v) => change('username', v, setUsername)}
                autoComplete="username"
              />
            )}
            <Field
              label={t('auth.email')}
              type="email"
              value={email}
              error={fieldErrors.email}
              onChange={(v) => change('email', v, setEmail)}
              autoComplete="email"
            />
            {mode !== 'forgot' && (
              <Field
                label={t('auth.password')}
                type={showPassword ? 'text' : 'password'}
                value={password}
                error={fieldErrors.password}
                onChange={(v) => change('password', v, setPassword)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                adornment={
                  <button
                    type="button"
                    // Parola alanı odaktayken göze basmasın diye tabIndex dışı:
                    // klavye kullanıcısı Tab ile parolayı geçip butona takılmasın.
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                }
              />
            )}

            {mode === 'login' && (
              <div className="-mt-2 mb-4 flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)]">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-[var(--color-line)] accent-[var(--color-brand)]"
                  />
                  {t('auth.rememberMe')}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setFieldErrors({});
                    setFormError(null);
                  }}
                  className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            )}

            {formError && (
              <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {busy
                ? t('common.loading')
                : mode === 'login'
                  ? t('auth.login')
                  : mode === 'register'
                    ? t('auth.register')
                    : t('auth.sendResetLink')}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'register' ? 'login' : mode === 'forgot' ? 'login' : 'register');
                setFieldErrors({});
                setFormError(null);
              }}
              className="mt-4 w-full text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {mode === 'login' ? t('auth.needAccount') : mode === 'register' ? t('auth.haveAccount') : t('auth.backToLogin')}
            </button>
          </>
        )}

        <LegalFooter />
      </form>
    </div>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  error?: string;
  /** Alanın içine yerleşen düğme (parola göster/gizle). */
  adornment?: ReactNode;
  onChange: (value: string) => void;
};

function Field({ label, value, error, adornment, onChange, type = 'text', ...rest }: FieldProps) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </span>
      {/* Hata alanın ÜSTÜNDE: kullanıcı düzeltmesi gereken yere bakarken
          mesajı da görsün, aşağı kaymasın. */}
      {error && (
        <span role="alert" className="mb-1 block text-xs text-[var(--color-danger)]">
          {error}
        </span>
      )}
      <span className="relative block">
        <input
          {...rest}
          type={type}
          value={value}
          aria-invalid={error !== undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded border bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none ${
            adornment ? 'pr-11' : ''
          } ${
            error
              ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
              : 'border-[var(--color-line)] focus:border-[var(--color-brand)]'
          }`}
        />
        {adornment}
      </span>
    </label>
  );
}
