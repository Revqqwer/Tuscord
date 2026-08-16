/**
 * Sunucu ayarları — sunucu adına/ikonuna sağ tık → Ayarlar.
 * İkon + banner yükleme, ad, açıklama, silme.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Camera, Trash2, X } from 'lucide-react';
import { Limits, guildNameError, type APIGuild } from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore, type GuildState } from '../store';
import { Avatar } from './Avatar';

interface Props {
  guildState: GuildState;
  onClose: () => void;
}

export function ServerSettings({ guildState, onClose }: Props) {
  const { t } = useTranslation();
  const guild = guildState.guild;
  const upsertGuild = useStore((s) => s.upsertGuild);
  const removeGuild = useStore((s) => s.removeGuild);
  const iconInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description ?? '');
  const [iconUrl, setIconUrl] = useState(guild.iconUrl);
  const [bannerUrl, setBannerUrl] = useState(guild.bannerUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function upload(kind: 'icon' | 'banner', file: File) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/v1/guilds/${guild.id}/${kind}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      setError(t('common.error'));
      return;
    }
    const updated = (await res.json()) as APIGuild;
    if (kind === 'icon') setIconUrl(updated.iconUrl);
    else setBannerUrl(updated.bannerUrl);
    upsertGuild({ ...guildState, guild: updated, voiceStates: [] });
  }

  // Sembolde anında, kısalıkta kaydetmeye basınca uyar (bkz. GuildModal).
  const [attempted, setAttempted] = useState(false);
  const nameProblem = guildNameError(name);
  const nameError = nameProblem === 'invalid_chars' || attempted ? nameProblem : null;

  async function save() {
    setAttempted(true);
    if (nameProblem !== null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<APIGuild>(`/guilds/${guild.id}`, {
        name,
        description: description || null,
      });
      upsertGuild({ ...guildState, guild: updated, voiceStates: [] });
    } catch {
      setError(t('guildModal.errors.guild_name_taken'));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm(t('serverSettings.deleteConfirm', { name: guild.name }))) return;
    await api.delete(`/guilds/${guild.id}`);
    removeGuild(guild.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('serverSettings.title')}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-medium">{t('serverSettings.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <X size={18} />
          </button>
        </header>

        {nameError && (
          <p
            role="alert"
            aria-live="polite"
            className="flex items-start gap-2 border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-2.5 text-sm text-[var(--color-danger)]"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>
              {t(`guildModal.nameErrors.${nameError}`, {
                min: Limits.GUILD_NAME_MIN,
                max: Limits.GUILD_NAME_MAX,
              })}
            </span>
          </p>
        )}

        <div className="space-y-5 p-5">
          {/* Banner */}
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            className="group relative block h-24 w-full overflow-hidden rounded-lg bg-[var(--color-surface-3)]"
            title={t('serverSettings.banner')}
          >
            {bannerUrl && <img src={bannerUrl} alt="" className="h-full w-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
              <Camera size={22} />
            </span>
          </button>
          <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('banner', f); e.target.value = ''; }} />

          {/* İkon + ad */}
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => iconInput.current?.click()} className="group relative" title={t('serverSettings.changeImage')}>
              <Avatar name={name} avatarUrl={iconUrl} size={64} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                <Camera size={20} />
              </span>
            </button>
            <input ref={iconInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('icon', f); e.target.value = ''; }} />
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('serverSettings.name')}
              </label>
              <input
                value={name}
                maxLength={Limits.GUILD_NAME_MAX}
                aria-invalid={nameError !== null}
                onChange={(e) => setName(e.target.value)}
                className={`w-full rounded border bg-[var(--color-surface-2)] px-3 py-2 outline-none ${
                  nameError
                    ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
                    : 'border-[var(--color-line)] focus:border-[var(--color-brand)]'
                }`}
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {t('serverSettings.description')}
            </span>
            <textarea
              value={description}
              rows={2}
              maxLength={Limits.GUILD_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
            />
          </label>

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
              {t('common.save')}
            </button>
            <button type="button" onClick={() => void del()} className="ml-auto flex items-center gap-1 rounded px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]">
              <Trash2 size={14} /> {t('serverSettings.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
