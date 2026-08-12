/**
 * Kendi profil/ayarlar modalı.
 *
 * Avatar, görünen ad, hakkında, dil; ayrıca hesap işlemleri (çıkış, veri
 * indirme, hesap silme — KVKK). Sunucu uçları zaten hazır; bu ekran onların
 * arayüzü.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, LogOut, X } from 'lucide-react';
import { Limits, type SelfUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore } from '../store';
import { setLocale } from '../i18n';
import { Avatar } from './Avatar';

interface Props {
  user: SelfUser;
  onClose: () => void;
}

export function UserSettings({ user, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const setUser = useStore((state) => state.setUser);
  const fileInput = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayed = displayName.trim() || user.username;

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.patch<SelfUser>('/users/@me', {
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
      });
      setUser(updated);
      setStatus(t('profile.saved'));
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/v1/users/@me/avatar', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!response.ok) {
        const code = ((await response.json()) as { code?: string }).code;
        setError(
          code === 'payload_too_large'
            ? t('profile.avatarTooLarge')
            : code === 'unsupported_file_type'
              ? t('profile.avatarNotImage')
              : t('common.error'),
        );
        return;
      }
      const { avatarUrl: url } = (await response.json()) as { avatarUrl: string };
      setAvatarUrl(url);
      setUser({ ...user, avatarUrl: url });
    } catch {
      setError(t('common.error'));
    }
  }

  function changeLanguage(next: 'tr' | 'en') {
    setLocale(next);
    void api.patch('/users/@me', { locale: next }).catch(() => undefined);
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => undefined);
    location.reload();
  }

  async function exportData() {
    const data = await api.get('/users/@me/data-export').catch(() => null);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tuscord-verilerim.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!confirm(t('profile.deleteConfirm'))) return;
    try {
      await api.post('/users/@me/delete');
      location.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'owns_guilds'
          ? caught.message
          : t('common.error'),
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('profile.settings')}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-medium">{t('profile.settings')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {/* Avatar + isim önizleme */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="group relative"
              title={t('profile.changeAvatar')}
            >
              <Avatar name={displayed} avatarUrl={avatarUrl} size={72} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                <Camera size={22} />
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
                event.target.value = '';
              }}
            />
            <div>
              <div className="text-lg font-semibold">{displayed}</div>
              <div className="text-sm text-[var(--color-ink-faint)]">
                {user.username}#{user.discriminator}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

          <Field label={t('profile.displayName')}>
            <input
              value={displayName}
              maxLength={Limits.DISPLAY_NAME_MAX}
              placeholder={t('profile.displayNamePlaceholder')}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
            />
          </Field>

          <Field label={t('profile.bio')}>
            <textarea
              value={bio}
              maxLength={Limits.BIO_MAX}
              rows={3}
              placeholder={t('profile.bioPlaceholder')}
              onChange={(event) => setBio(event.target.value)}
              className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
            />
            <div className="mt-1 text-right text-xs text-[var(--color-ink-faint)]">
              {bio.length}/{Limits.BIO_MAX}
            </div>
          </Field>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {t('profile.save')}
            </button>
            {status && <span className="text-sm text-[var(--color-online)]">{status}</span>}
          </div>

          {/* Dil */}
          <Field label={t('profile.language')}>
            <div className="flex gap-2">
              {(['tr', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => changeLanguage(lang)}
                  className={`rounded px-3 py-1.5 text-sm ${
                    i18n.language === lang
                      ? 'bg-[var(--color-brand)] text-black'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-ink-muted)]'
                  }`}
                >
                  {lang === 'tr' ? 'Türkçe' : 'English'}
                </button>
              ))}
            </div>
          </Field>

          {/* Hesap */}
          <div className="border-t border-[var(--color-line)] pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('profile.account')}
            </div>
            <div className="mb-3 text-sm text-[var(--color-ink-muted)]">
              {t('profile.email')}: {user.email}{' '}
              <span className={user.emailVerified ? 'text-[var(--color-online)]' : 'text-[var(--color-idle)]'}>
                ({user.emailVerified ? t('profile.emailVerified') : t('profile.emailUnverified')})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void logout()}
                className="flex items-center gap-1.5 rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
              >
                <LogOut size={14} /> {t('profile.logout')}
              </button>
              <button
                type="button"
                onClick={() => void exportData()}
                className="rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
              >
                {t('profile.exportData')}
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                className="rounded px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
              >
                {t('profile.deleteAccount')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}
