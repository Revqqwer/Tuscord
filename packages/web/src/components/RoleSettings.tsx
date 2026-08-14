/**
 * Rol ve izin matrisi ekranı.
 *
 * İki kural arayüzde de görünür kılınır (sunucu zaten uyguluyor):
 *  1. Kendi en yüksek rolünden yüksek veya eşit bir rolü düzenleyemezsin.
 *  2. Sahip olmadığın bir izni bir role veremezsin — yetki yükseltmenin
 *     klasik yolu budur.
 *
 * Kilitli anahtarlar gizlenmez, devre dışı bırakılır: kullanıcının neyi
 * neden yapamadığını görmesi, seçeneğin yok olmasından iyidir.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Plus, Shield, Trash2, X } from 'lucide-react';
import {
  ALL_PERMISSIONS,
  ChannelType,
  PERMISSION_GROUPS,
  Permission,
  has,
  type APIChannel,
  type APIGuildMember,
  type APIRole,
  type PermissionName,
} from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore, type GuildState } from '../store';

interface Props {
  guildState: GuildState;
  onClose: () => void;
}

export function RoleSettings({ guildState, onClose }: Props) {
  const { t } = useTranslation();
  const guildId = guildState.guild.id;
  const currentUserId = useStore((state) => state.user?.id ?? null);

  const [roles, setRoles] = useState<APIRole[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** "Görüntülenecek kanalları seç" akordeonu — rol değişince kapanmaz. */
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);

  const isOwner = currentUserId === guildState.guild.ownerId;

  /** Kullanıcının kendi izinleri — bir izni verebilmesi için kendisinde olmalı. */
  const ownPermissions = useMemo(() => {
    if (isOwner) return ALL_PERMISSIONS;
    return BigInt(guildState.permissions);
  }, [guildState.permissions, isOwner]);

  /** Kullanıcının en yüksek rol konumu; hiyerarşi kilidi buna bakar. */
  const ownHighestPosition = useMemo(() => {
    if (isOwner) return Number.POSITIVE_INFINITY;
    const own = guildState.member.roles
      .map((roleId) => roles.find((role) => role.id === roleId)?.position ?? 0)
      .reduce((max, position) => Math.max(max, position), 0);
    return own;
  }, [guildState.member.roles, roles, isOwner]);

  async function load() {
    const list = await api.get<APIRole[]>(`/guilds/${guildId}/roles`).catch(() => []);
    // Yüksek konum üstte — hiyerarşiyi göründüğü gibi okuyabilmek için.
    const sorted = [...list].sort((a, b) => b.position - a.position);
    setRoles(sorted);
    setSelectedId((current) => current ?? sorted[0]?.id ?? null);
  }

  useEffect(() => {
    void load();
  }, [guildId]);

  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const isEveryone = selected?.id === guildId;
  const locked = selected !== null && !isOwner && selected.position >= ownHighestPosition;

  async function patch(changes: Partial<APIRole>) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<APIRole>(`/guilds/${guildId}/roles/${selected.id}`, changes);
      setRoles((current) =>
        current.map((role) => (role.id === updated.id ? updated : role)),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'cannot_grant_permissions'
          ? t('roles.cannotGrant')
          : caught instanceof ApiError && caught.code === 'role_hierarchy'
            ? t('roles.lockedByHierarchy')
            : t('common.error'),
      );
      // Sunucu reddettiyse yerel görüntü yanlış kalmasın.
      await load();
    } finally {
      setSaving(false);
    }
  }

  function togglePermission(name: PermissionName, enabled: boolean) {
    if (!selected) return;
    const bit = Permission[name];
    const current = BigInt(selected.permissions);
    const next = enabled ? current | bit : current & ~bit;
    void patch({ permissions: next.toString() });
  }

  async function createRole() {
    setError(null);
    try {
      await api.post(`/guilds/${guildId}/roles`, { name: t('roles.newRoleName') });
      await load();
    } catch {
      setError(t('common.error'));
    }
  }

  async function deleteRole() {
    if (!selected || isEveryone) return;
    if (!confirm(t('roles.deleteConfirm', { name: selected.name }))) return;
    try {
      await api.delete(`/guilds/${guildId}/roles/${selected.id}`);
      setSelectedId(null);
      await load();
    } catch {
      setError(t('common.error'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('roles.title')}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[85vh] w-full max-w-5xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <Shield size={18} className="text-[var(--color-brand)]" />
          <h2 className="font-medium">{t('roles.title')}</h2>
          <span className="text-sm text-[var(--color-ink-faint)]">{guildState.guild.name}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Rol listesi */}
          <div className="flex w-56 shrink-0 flex-col border-r border-[var(--color-line)]">
            <div className="flex-1 overflow-y-auto p-2">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedId(role.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    role.id === selectedId
                      ? 'bg-[var(--color-surface-3)]'
                      : 'hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-[var(--color-line)]"
                    style={{
                      background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'transparent',
                    }}
                  />
                  <span className="truncate">{role.id === guildId ? '@everyone' : role.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void createRole()}
              className="m-2 flex items-center justify-center gap-1 rounded bg-[var(--color-brand)] px-2 py-1.5 text-sm font-medium text-black"
            >
              <Plus size={14} /> {t('roles.create')}
            </button>
          </div>

          {/* Seçili rolün ayarları */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!selected ? (
              <p className="text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>
            ) : (
              <>
                {error && (
                  <p role="alert" className="mb-3 rounded bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)]">
                    {error}
                  </p>
                )}

                {locked && (
                  <p className="mb-3 rounded bg-[var(--color-idle)]/15 px-3 py-2 text-sm text-[var(--color-idle)]">
                    {t('roles.lockedByHierarchy')}
                  </p>
                )}

                {isEveryone && (
                  <p className="mb-3 rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                    {t('roles.everyoneNote')}
                  </p>
                )}

                {!isEveryone && (
                  <div className="mb-4 flex flex-wrap items-end gap-4">
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                        {t('roles.name')}
                      </span>
                      <input
                        defaultValue={selected.name}
                        disabled={locked || saving}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value && value !== selected.name) void patch({ name: value });
                        }}
                        className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                        {t('roles.color')}
                      </span>
                      <input
                        type="color"
                        disabled={locked || saving}
                        value={`#${selected.color.toString(16).padStart(6, '0')}`}
                        onChange={(event) =>
                          void patch({ color: parseInt(event.target.value.slice(1), 16) })
                        }
                        className="h-9 w-16 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] disabled:opacity-50"
                      />
                    </label>

                    <Toggle
                      label={t('roles.hoist')}
                      checked={selected.hoist}
                      disabled={locked || saving}
                      onChange={(value) => void patch({ hoist: value })}
                    />
                    <Toggle
                      label={t('roles.mentionable')}
                      checked={selected.mentionable}
                      disabled={locked || saving}
                      onChange={(value) => void patch({ mentionable: value })}
                    />

                    <button
                      type="button"
                      onClick={() => void deleteRole()}
                      disabled={locked}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                    >
                      <Trash2 size={14} /> {t('roles.delete')}
                    </button>
                  </div>
                )}

                {PERMISSION_GROUPS.map((group) => (
                  <section key={group.id} className="mb-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                      {t(`roles.groups.${group.id}`)}
                    </h3>
                    <div className="space-y-1">
                      {group.permissions.map((name) => {
                        const bit = Permission[name];
                        const enabled = has(BigInt(selected.permissions), bit);
                        // Sahip olmadığın izni veremezsin (sunucu da reddeder).
                        const cannotGrant = !has(ownPermissions, bit);
                        const row = (
                          <PermissionRow
                            key={name}
                            name={t(`roles.permissions.${name}.name`)}
                            description={t(`roles.permissions.${name}.description`)}
                            danger={name === 'ADMINISTRATOR'}
                            checked={enabled}
                            disabled={locked || saving || (cannotGrant && !enabled)}
                            hint={cannotGrant && !enabled ? t('roles.cannotGrant') : undefined}
                            onChange={(value) => togglePermission(name, value)}
                            expandable={name === 'VIEW_CHANNEL'}
                            expanded={name === 'VIEW_CHANNEL' ? channelPickerOpen : undefined}
                            onToggleExpand={
                              name === 'VIEW_CHANNEL'
                                ? () => setChannelPickerOpen((v) => !v)
                                : undefined
                            }
                          />
                        );
                        // Seçici, VIEW_CHANNEL satırının hemen altında — o
                        // satır yalnızca 'general' grubunda bir kez geçer.
                        if (name !== 'VIEW_CHANNEL') return row;
                        return (
                          <div key={name}>
                            {row}
                            {channelPickerOpen && (
                              <ChannelVisibilityPicker
                                channels={guildState.channels}
                                role={selected}
                                disabled={locked || saving}
                                onError={() => setError(t('common.error'))}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}

                {!isEveryone && <RoleMembers guildId={guildId} roleId={selected.id} locked={locked} onChanged={load} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({
  name,
  description,
  checked,
  disabled,
  danger,
  hint,
  onChange,
  expandable,
  expanded,
  onToggleExpand,
}: {
  name: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  danger?: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
  /** Sağında aç/kapa oku olsun mu — yalnızca VIEW_CHANNEL için true. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-start gap-3 rounded px-2 py-1.5 ${
        disabled ? 'opacity-50' : 'hover:bg-[var(--color-surface-2)]'
      }`}
    >
      <label title={hint} className="flex min-w-0 flex-1 items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
        />
        <span className="min-w-0">
          <span className={`block text-sm ${danger ? 'text-[var(--color-danger)]' : ''}`}>{name}</span>
          <span className="block text-xs text-[var(--color-ink-faint)]">{description}</span>
        </span>
      </label>
      {expandable && (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={t('roles.channelPicker.toggle')}
          title={t('roles.channelPicker.toggle')}
          className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      )}
    </div>
  );
}

/**
 * "Görüntülenecek kanalları seç" — VIEW_CHANNEL satırının altında açılan
 * panel. Metin kanalları solda, ses kanalları sağda; her kanal bu rol için
 * ayrı bir onay kutusu. İşaretlemek/kaldırmak o kanalda role özel bir
 * overwrite yazar (mevcut ChannelSettings overwrite editörüyle AYNI uç,
 * yalnızca VIEW_CHANNEL bitini hedefler — diğer overwrite'lı izinlere
 * dokunmaz).
 */
function ChannelVisibilityPicker({
  channels,
  role,
  disabled,
  onError,
}: {
  channels: readonly APIChannel[];
  role: APIRole;
  disabled: boolean;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const textChannels = channels
    .filter((c) => c.type === ChannelType.GUILD_TEXT)
    .sort((a, b) => a.position - b.position);
  const voiceChannels = channels
    .filter((c) => c.type === ChannelType.GUILD_VOICE)
    .sort((a, b) => a.position - b.position);

  function isVisible(channel: APIChannel): boolean {
    const overwrite = channel.overwrites?.find(
      (o) => o.targetType === 'role' && o.targetId === role.id,
    );
    if (overwrite) {
      if (has(BigInt(overwrite.deny), Permission.VIEW_CHANNEL)) return false;
      if (has(BigInt(overwrite.allow), Permission.VIEW_CHANNEL)) return true;
    }
    // Overwrite yok ya da VIEW_CHANNEL'a dokunmuyor: rolün kendi temel izni geçerli.
    return has(BigInt(role.permissions), Permission.VIEW_CHANNEL);
  }

  async function toggle(channel: APIChannel, next: boolean) {
    setBusyId(channel.id);
    try {
      const overwrite = channel.overwrites?.find(
        (o) => o.targetType === 'role' && o.targetId === role.id,
      );
      let allow = overwrite ? BigInt(overwrite.allow) : 0n;
      let deny = overwrite ? BigInt(overwrite.deny) : 0n;
      if (next) {
        allow |= Permission.VIEW_CHANNEL;
        deny &= ~Permission.VIEW_CHANNEL;
      } else {
        deny |= Permission.VIEW_CHANNEL;
        allow &= ~Permission.VIEW_CHANNEL;
      }
      await api.put(`/channels/${channel.id}/permissions/${role.id}`, {
        targetType: 'role',
        allow: allow.toString(),
        deny: deny.toString(),
      });
      // Yeni durum CHANNEL_UPDATE gateway olayıyla geri gelir (bkz.
      // channels.ts) ve `channels` prop'u store üzerinden tazelenir —
      // burada elle bir yerel güncelleme gerekmiyor.
    } catch {
      onError();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-2 ml-8 grid grid-cols-2 gap-4 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <ChannelVisibilityColumn
        title={t('roles.channelPicker.text')}
        channels={textChannels}
        isVisible={isVisible}
        busyId={busyId}
        disabled={disabled}
        onToggle={toggle}
      />
      <ChannelVisibilityColumn
        title={t('roles.channelPicker.voice')}
        channels={voiceChannels}
        isVisible={isVisible}
        busyId={busyId}
        disabled={disabled}
        onToggle={toggle}
      />
    </div>
  );
}

function ChannelVisibilityColumn({
  title,
  channels,
  isVisible,
  busyId,
  disabled,
  onToggle,
}: {
  title: string;
  channels: APIChannel[];
  isVisible: (channel: APIChannel) => boolean;
  busyId: string | null;
  disabled: boolean;
  onToggle: (channel: APIChannel, next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {title}
      </div>
      {channels.length === 0 ? (
        <p className="text-xs text-[var(--color-ink-faint)]">{t('roles.channelPicker.empty')}</p>
      ) : (
        <div className="space-y-0.5">
          {channels.map((channel) => (
            <label
              key={channel.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--color-surface-3)]"
            >
              <input
                type="checkbox"
                checked={isVisible(channel)}
                disabled={disabled || busyId === channel.id}
                onChange={(event) => void onToggle(channel, event.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="truncate text-[var(--color-ink-muted)]">{channel.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--color-brand)]"
      />
      {label}
    </label>
  );
}

/** Rolü taşıyan üyeler ve rol atama. */
function RoleMembers({
  guildId,
  roleId,
  locked,
  onChanged,
}: {
  guildId: string;
  roleId: string;
  locked: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const members = useStore((state) => state.members.get(guildId) ?? []);
  const setMembers = useStore((state) => state.setMembers);
  const [busy, setBusy] = useState(false);

  const holders = members.filter((member) => member.roles.includes(roleId));
  const others = members.filter((member) => !member.roles.includes(roleId));

  async function refresh() {
    const list = await api
      .get<APIGuildMember[]>(`/guilds/${guildId}/members?limit=200`)
      .catch(() => []);
    setMembers(guildId, list);
    await onChanged();
  }

  async function toggle(userId: string, add: boolean) {
    setBusy(true);
    try {
      const path = `/guilds/${guildId}/members/${userId}/roles/${roleId}`;
      await (add ? api.put(path) : api.delete(path));
      await refresh();
    } catch {
      // Hata mesajı üst bileşende gösteriliyor; burada sessizce tazele.
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-[var(--color-line)] pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {t('roles.members')}
      </h3>

      <div className="mb-3 flex flex-wrap gap-2">
        {holders.map((member) => (
          <span
            key={member.user.id}
            className="flex items-center gap-1 rounded bg-[var(--color-surface-2)] px-2 py-1 text-sm"
          >
            {member.nickname ?? member.user.displayName ?? member.user.username}
            <button
              type="button"
              disabled={locked || busy}
              onClick={() => void toggle(member.user.id, false)}
              aria-label={t('common.delete')}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] disabled:opacity-40"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {holders.length === 0 && (
          <span className="text-sm text-[var(--color-ink-faint)]">—</span>
        )}
      </div>

      {others.length > 0 && (
        <select
          disabled={locked || busy}
          defaultValue=""
          onChange={(event) => {
            const userId = event.target.value;
            event.target.value = '';
            if (userId) void toggle(userId, true);
          }}
          className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="" disabled>
            {t('roles.assign')}
          </option>
          {others.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.nickname ?? member.user.displayName ?? member.user.username}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
