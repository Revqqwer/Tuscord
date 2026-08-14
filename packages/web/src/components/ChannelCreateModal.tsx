/**
 * Kanal oluştur — metin ya da sesli seçimi. Eski prompt() yerine.
 * Yeni kanal CHANNEL_CREATE olayıyla listeye düşer.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Hash, Volume2, X } from 'lucide-react';
import { ChannelType, Limits, channelNameError, normalizeChannelName } from '@tuscord/shared';
import { api } from '../lib/api';

interface Props {
  guildId: string;
  /** Rolde CREATE_TEXT_CHANNELS/CREATE_VOICE_CHANNELS var mı — ilgisiz seçenek devre dışı. */
  canCreateText: boolean;
  canCreateVoice: boolean;
  onClose: () => void;
}

export function ChannelCreateModal({ guildId, canCreateText, canCreateVoice, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // "+" düğmesi zaten yalnızca en az biri açıkken görünür (bkz. ChatShell);
  // hangisi izinliyse o varsayılan seçili gelsin.
  const [type, setType] = useState<ChannelType>(
    canCreateText ? ChannelType.GUILD_TEXT : ChannelType.GUILD_VOICE,
  );
  const [busy, setBusy] = useState(false);

  // Sunucu ile AYNI kural (`channelNameError`), ama burada anında geri bildirim
  // için. Güvenlik sınırı sunucudadır; bu yalnızca kolaylık.
  const trimmed = name.trim();
  const normalized = normalizeChannelName(name);
  const error = channelNameError(name);

  // Sembol hatası yazarken ANINDA gösterilir — kullanıcı `!` tuşuna bastığı an
  // neden kabul edilmediğini görmeli. "Çok kısa" uyarısı ise ancak oluşturmaya
  // basınca çıkar: ilk harfi yazan herkese kırmızı uyarı göstermek gürültü.
  const [attempted, setAttempted] = useState(false);
  const nameError = error === 'invalid_chars' || attempted ? error : null;

  async function create() {
    setAttempted(true);
    // Buton kasıtlı olarak pasif değil: tıklama, kısa adda uyarıyı ortaya
    // çıkaran şey. Engelleme burada.
    if (error !== null || busy) return;
    setBusy(true);
    try {
      await api.post(`/guilds/${guildId}/channels`, { name: trimmed, type });
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('channel.create')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-medium">{t('channel.create')}</h2>
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
              {t(`channel.errors.${nameError}`, {
                min: Limits.CHANNEL_NAME_MIN,
                max: Limits.CHANNEL_NAME_MAX,
              })}
            </span>
          </p>
        )}

        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {t('channel.type')}
            </div>
            <div className="space-y-2">
              {canCreateText && (
                <TypeOption
                  active={type === ChannelType.GUILD_TEXT}
                  icon={<Hash size={18} />}
                  label={t('channel.text')}
                  desc={t('channel.textDesc')}
                  onClick={() => setType(ChannelType.GUILD_TEXT)}
                />
              )}
              {canCreateVoice && (
                <TypeOption
                  active={type === ChannelType.GUILD_VOICE}
                  icon={<Volume2 size={18} />}
                  label={t('channel.voice')}
                  desc={t('channel.voiceDesc')}
                  onClick={() => setType(ChannelType.GUILD_VOICE)}
                />
              )}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {t('channel.name')}
            </span>
            <input
              autoFocus
              value={name}
              maxLength={Limits.CHANNEL_NAME_MAX}
              aria-invalid={nameError !== null}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              className={`w-full rounded border bg-[var(--color-surface-2)] px-3 py-2 outline-none ${
                nameError
                  ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]'
                  : 'border-[var(--color-line)] focus:border-[var(--color-brand)]'
              }`}
            />
            {/* Girilen ad boşluk/büyük harf yüzünden değişiyorsa sonucu göster. */}
            {!nameError && normalized.length > 0 && normalized !== trimmed && (
              <span className="mt-1.5 block text-xs text-[var(--color-ink-faint)]">
                {t('channel.preview', { name: normalized })}
              </span>
            )}
          </label>

          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeOption({
  active,
  icon,
  label,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10'
          : 'border-[var(--color-line)] hover:bg-[var(--color-surface-2)]'
      }`}
    >
      <span className="text-[var(--color-ink-muted)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-[var(--color-ink-faint)]">{desc}</span>
      </span>
      <span
        className={`h-4 w-4 shrink-0 rounded-full border-2 ${
          active ? 'border-[var(--color-brand)] bg-[var(--color-brand)]' : 'border-[var(--color-line)]'
        }`}
      />
    </button>
  );
}
