/**
 * Sunucu oluştur / katıl modalı — eski `prompt()` yerine.
 *
 * İki sekme: Oluştur (isim benzersiz) ve Katıl (davet linki ya da sunucu adı).
 * Katılma iki yolu da destekler: `/davet/<kod>` linkinden kodu ayıklar,
 * yoksa girileni sunucu adı sayar.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import { Limits, guildNameError } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';

interface Props {
  onClose: () => void;
  /** Katılınan/oluşturulan sunucuyu aç. */
  onDone: (guildId: string) => void;
}

const INVITE_IN_TEXT = /(?:davet|invite)\/([A-Za-z0-9_-]{4,12})/;

export function GuildModal({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [joinValue, setJoinValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function showError(caught: unknown) {
    const code = caught instanceof ApiError ? caught.code : 'unknown';
    const key = `guildModal.errors.${code}`;
    const translated = t(key);
    setError(translated === key ? t('common.error') : translated);
  }

  // Kanal adıyla aynı akış: sembol hatası anında, "çok kısa" oluşturmaya
  // basınca. Bkz. ChannelCreateModal.
  const [attempted, setAttempted] = useState(false);
  const nameProblem = guildNameError(name);
  const nameError = nameProblem === 'invalid_chars' || attempted ? nameProblem : null;

  async function create() {
    setAttempted(true);
    if (nameProblem !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const guild = await api.post<{ id: string }>('/guilds', { name: name.trim() });
      onDone(guild.id);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    const value = joinValue.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const explicitCode = INVITE_IN_TEXT.exec(value)?.[1];
      if (explicitCode) {
        // Girdi bir davet linki: kod belli, başka ihtimal yok.
        const guild = await api.post<{ id: string }>(`/invites/${explicitCode}/join`);
        onDone(guild.id);
        return;
      }

      // Düz metin girildiğinde sunucu adı mı davet kodu mu belli değil —
      // ikisi de alfasayısal ve uzunlukları örtüşüyor ("Deneme" hem geçerli
      // bir sunucu adı hem de görünüşte bir davet kodu). Eskiden burada
      // biçime bakan bir tahmin vardı; kısa/alfasayısal her sunucu adını
      // (Discord tarzı çoğu ad böyledir) yanlışlıkla davet kodu sayıp
      // "bulunamadı" veriyordu. Artık ÖNCE sunucu adı deneniyor — kullanıcı
      // çoğunlukla bunu yazıyor — yalnızca `unknown_guild` dönerse ve girdi
      // bir davet kodu gibi görünüyorsa (boşluksuz, kısa) ikinci ihtimal
      // denenir.
      try {
        const guild = await api.post<{ id: string }>('/guilds/join', { name: value });
        onDone(guild.id);
      } catch (nameCaught) {
        const looksLikeInviteCode = /^[A-Za-z0-9_-]{4,12}$/.test(value);
        if (looksLikeInviteCode && nameCaught instanceof ApiError && nameCaught.code === 'unknown_guild') {
          const guild = await api.post<{ id: string }>(`/invites/${value}/join`);
          onDone(guild.id);
          return;
        }
        throw nameCaught;
      }
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('guildModal.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl bg-[var(--color-surface-1)] shadow-2xl"
      >
        <div className="flex border-b border-[var(--color-line)]">
          <Tab active={tab === 'create'} onClick={() => { setTab('create'); setError(null); }}>
            {t('guildModal.createTab')}
          </Tab>
          <Tab active={tab === 'join'} onClick={() => { setTab('join'); setError(null); }}>
            {t('guildModal.joinTab')}
          </Tab>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto px-4 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </div>

        {tab === 'create' && nameError && (
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

        <div className="p-6">
          {tab === 'create' ? (
            <>
              <h2 className="mb-1 text-center text-xl font-semibold">{t('guildModal.createTitle')}</h2>
              <p className="mb-5 text-center text-sm text-[var(--color-ink-muted)]">
                {t('guildModal.createDesc')}
              </p>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('guildModal.nameLabel')}
              </label>
              <input
                autoFocus
                value={name}
                maxLength={Limits.GUILD_NAME_MAX}
                aria-invalid={nameError !== null}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                className={`w-full rounded border bg-[var(--color-surface-2)] px-3 py-2 outline-none ${
                  nameError
                    ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
                    : 'border-[var(--color-line)] focus:border-[var(--color-brand)]'
                }`}
              />
              {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy}
                className="mt-5 w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
              >
                {t('guildModal.create')}
              </button>
            </>
          ) : (
            <>
              <h2 className="mb-1 text-center text-xl font-semibold">{t('guildModal.joinTitle')}</h2>
              <p className="mb-5 text-center text-sm text-[var(--color-ink-muted)]">
                {t('guildModal.joinDesc')}
              </p>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {t('guildModal.joinInputLabel')}
              </label>
              <input
                autoFocus
                value={joinValue}
                onChange={(e) => setJoinValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && joinValue.trim() && void join()}
                placeholder={t('guildModal.joinInputPlaceholder')}
                className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
              />
              {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
              <button
                type="button"
                onClick={() => void join()}
                disabled={busy || joinValue.trim().length === 0}
                className="mt-5 w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
              >
                {t('guildModal.join')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium transition ${
        active
          ? 'border-b-2 border-[var(--color-brand)] text-[var(--color-ink)]'
          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}
