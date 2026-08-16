/**
 * Kanal oluştur — metin ya da sesli seçimi. Eski prompt() yerine.
 * Yeni kanal CHANNEL_CREATE olayıyla listeye düşer.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Hash, Lock, Volume2, X } from 'lucide-react';
import {
  ChannelType,
  Limits,
  Permission,
  channelNameError,
  normalizeChannelName,
  type APIChannel,
  type APIRole,
} from '@tuscord/shared';
import { api } from '../lib/api';

interface Props {
  guildId: string;
  /** Rolde CREATE_TEXT_CHANNELS/CREATE_VOICE_CHANNELS var mı — ilgisiz seçenek devre dışı. */
  canCreateText: boolean;
  canCreateVoice: boolean;
  /** @everyone dahil sunucudaki tüm roller — "kimler görebilsin" seçici için. */
  roles: APIRole[];
  onClose: () => void;
}

export function ChannelCreateModal({ guildId, canCreateText, canCreateVoice, roles, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // "+" düğmesi zaten yalnızca en az biri açıkken görünür (bkz. ChatShell);
  // hangisi izinliyse o varsayılan seçili gelsin.
  const [type, setType] = useState<ChannelType>(
    canCreateText ? ChannelType.GUILD_TEXT : ChannelType.GUILD_VOICE,
  );
  const [busy, setBusy] = useState(false);
  // Varsayılan: herkes görebilir (mevcut davranış). Açılırsa yalnızca
  // işaretlenen roller görebilsin — @everyone'dan VIEW_CHANNEL düşer,
  // seçili rollere overwrite ile geri verilir (bkz. create()).
  const [restricted, setRestricted] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const pickableRoles = roles.filter((r) => r.id !== guildId);

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
    if (restricted && selectedRoleIds.size === 0) return; // kimse göremeyen bir kanal anlamsız
    setBusy(true);
    try {
      const channel = await api.post<APIChannel>(`/guilds/${guildId}/channels`, { name: trimmed, type });
      if (restricted) {
        const VIEW_CHANNEL = Permission.VIEW_CHANNEL.toString();
        // @everyone'dan görünürlüğü düş, yalnızca seçili rollere geri ver —
        // Rol Ayarları'ndaki "Görüntülenecek Kanallar" seçicisiyle AYNI uç.
        await Promise.all([
          api.put(`/channels/${channel.id}/permissions/${guildId}`, {
            targetType: 'role',
            allow: '0',
            deny: VIEW_CHANNEL,
          }),
          ...[...selectedRoleIds].map((roleId) =>
            api.put(`/channels/${channel.id}/permissions/${roleId}`, {
              targetType: 'role',
              allow: VIEW_CHANNEL,
              deny: '0',
            }),
          ),
        ]);
      }
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

          {pickableRoles.length > 0 && (
            <div>
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                  <Lock size={13} /> {t('channel.restrictVisibility')}
                </span>
                <input
                  type="checkbox"
                  checked={restricted}
                  onChange={(e) => setRestricted(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-brand)]"
                />
              </label>
              {restricted && (
                <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
                  {pickableRoles.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--color-surface-3)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoleIds.has(role.id)}
                        onChange={(e) =>
                          setSelectedRoleIds((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(role.id);
                            else next.delete(role.id);
                            return next;
                          })
                        }
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand)]"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-line)]"
                        style={{
                          background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'transparent',
                        }}
                      />
                      <span className="truncate text-[var(--color-ink-muted)]">{role.name}</span>
                    </label>
                  ))}
                  {selectedRoleIds.size === 0 && (
                    <p className="px-1.5 pt-1 text-xs text-[var(--color-idle)]">
                      {t('channel.restrictVisibilityEmpty')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || (restricted && selectedRoleIds.size === 0)}
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
