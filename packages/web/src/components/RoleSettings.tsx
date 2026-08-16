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

/** Bir kanalda VIEW_CHANNEL için rolün taşıdığı overwrite durumu. */
type ViewOverride = 'allow' | 'deny' | 'inherit';

/**
 * Kanalın GERÇEK (sunucudaki) overwrite'ından bu rol için VIEW_CHANNEL
 * durumunu okur — taslağın BAŞLANGIÇ noktası ve "değişti mi" kıyaslaması
 * bunun üzerinden yapılır.
 */
function currentViewOverride(channel: APIChannel, roleId: string): ViewOverride {
  const overwrite = channel.overwrites?.find((o) => o.targetType === 'role' && o.targetId === roleId);
  if (!overwrite) return 'inherit';
  if (has(BigInt(overwrite.deny), Permission.VIEW_CHANNEL)) return 'deny';
  if (has(BigInt(overwrite.allow), Permission.VIEW_CHANNEL)) return 'allow';
  return 'inherit';
}

/** Bir override + temel izin verildiğinde kanalın görünür olup olmadığı. */
function resolveVisible(override: ViewOverride, basePermissions: string): boolean {
  if (override === 'deny') return false;
  if (override === 'allow') return true;
  return has(BigInt(basePermissions), Permission.VIEW_CHANNEL);
}

/** Bu rolün TÜM kanalları için başlangıç override haritası (bkz. RoleDraft.channelOverrides). */
function buildChannelOverrides(
  channels: readonly APIChannel[],
  roleId: string,
): Map<string, ViewOverride> {
  const map = new Map<string, ViewOverride>();
  for (const channel of channels) {
    if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_VOICE) continue;
    map.set(channel.id, currentViewOverride(channel, roleId));
  }
  return map;
}

/** Seçili rolün düzenlenebilir alanlarının yerel taslağı — bkz. RoleSettings yorumu. */
interface RoleDraft {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  /** Bitfield, string (bigint JSON'da taşınamaz — projedeki genel kural). */
  permissions: string;
  /**
   * "Görüntülenecek kanallar" seçicisindeki kanal-özel VIEW_CHANNEL
   * durumları — ESKİDEN her tıklama anında ayrı bir PUT ile kaydediliyordu,
   * bu yüzden "Kaydet" hiç görünmüyordu ve diğer taslak alanlarıyla
   * TUTARSIZDI (bkz. kullanıcı raporu). Artık diğer her şey gibi yalnızca
   * "Kaydet"e basınca tek seferde gönderilir (bkz. save()).
   */
  channelOverrides: Map<string, ViewOverride>;
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
  /**
   * Seçili rolün DÜZENLENEBİLİR alanlarının yerel taslağı — her değişiklik
   * artık anında sunucuya gitmez, yalnızca "Kaydet"e basınca tek bir PATCH
   * ile gönderilir. Rol değişince (ya da kaydettikten sonra) `selected`'tan
   * yeniden kurulur (bkz. aşağıdaki useEffect).
   */
  const [draft, setDraft] = useState<RoleDraft | null>(null);

  const isOwner = currentUserId === guildState.guild.ownerId;

  /** Kullanıcının kendi izinleri — bir izni verebilmesi için kendisinde olmalı. */
  const ownPermissions = useMemo(() => {
    if (isOwner) return ALL_PERMISSIONS;
    return BigInt(guildState.permissions);
  }, [guildState.permissions, isOwner]);

  /**
   * Rol TANIMLARINI düzenleme (ad/renk/izinler/kanal görünürlüğü/oluşturma/
   * silme) — ASSIGN_ROLES'ten AYRI bir yetki (bkz. permissions.ts yorumu).
   * Yalnızca ASSIGN_ROLES taşıyan biri bu ekranı açabilir (bkz. ChatShell.tsx
   * canManageRoles) ama yalnızca "Bu roldeki üyeler" bölümünü kullanabilmeli.
   */
  const canEditRoleDefs = has(ownPermissions, Permission.MANAGE_ROLES);

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

  // Rol değişince (ya da sunucudan tazelenince) taslağı SIFIRDAN kur —
  // önceki rolün kaydedilmemiş taslağı bir sonrakine sızmasın.
  useEffect(() => {
    setDraft(
      selected
        ? {
            name: selected.name,
            color: selected.color,
            hoist: selected.hoist,
            mentionable: selected.mentionable,
            permissions: selected.permissions,
            channelOverrides: buildChannelOverrides(guildState.channels, selected.id),
          }
        : null,
    );
    // guildState.channels bilinçli DIŞARIDA bırakıldı: yalnızca rol
    // değişince/kaydedince taslağı sıfırlamak istiyoruz, kanal listesi
    // KAYDET'ten ÖNCE (bizim taslağımız dururken) başka bir sebeple
    // güncellenirse taslağımızı ezmesin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.name, selected?.color, selected?.hoist, selected?.mentionable, selected?.permissions]);

  const channelOverridesDirty = (() => {
    if (!draft || !selected) return false;
    for (const channel of guildState.channels) {
      if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_VOICE) continue;
      const wanted = draft.channelOverrides.get(channel.id) ?? 'inherit';
      if (wanted !== currentViewOverride(channel, selected.id)) return true;
    }
    return false;
  })();

  const dirty =
    !!selected &&
    !!draft &&
    (draft.name !== selected.name ||
      draft.color !== selected.color ||
      draft.hoist !== selected.hoist ||
      draft.mentionable !== selected.mentionable ||
      draft.permissions !== selected.permissions ||
      channelOverridesDirty);

  function updateDraft(changes: Partial<RoleDraft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  function updateChannelOverride(channelId: string, next: ViewOverride) {
    setDraft((current) => {
      if (!current) return current;
      const channelOverrides = new Map(current.channelOverrides);
      channelOverrides.set(channelId, next);
      return { ...current, channelOverrides };
    });
  }

  async function save() {
    if (!selected || !draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Yalnızca DEĞİŞEN alanları gönder — dokunulmayanlar audit kaydında
      // gürültü olmasın.
      const changes: Partial<APIRole> = {};
      if (draft.name !== selected.name) changes.name = draft.name;
      if (draft.color !== selected.color) changes.color = draft.color;
      if (draft.hoist !== selected.hoist) changes.hoist = draft.hoist;
      if (draft.mentionable !== selected.mentionable) changes.mentionable = draft.mentionable;
      if (draft.permissions !== selected.permissions) changes.permissions = draft.permissions;

      const [updated] = await Promise.all([
        Object.keys(changes).length > 0
          ? api.patch<APIRole>(`/guilds/${guildId}/roles/${selected.id}`, changes)
          : Promise.resolve(selected),
        // Yalnızca GERÇEKTEN değişen kanal overwrite'larını gönder — diğer
        // izin bitlerine dokunmadan yalnızca VIEW_CHANNEL'ı hedefler.
        ...guildState.channels
          .filter((c) => c.type === ChannelType.GUILD_TEXT || c.type === ChannelType.GUILD_VOICE)
          .map((channel) => {
            const wanted = draft.channelOverrides.get(channel.id) ?? 'inherit';
            const current = currentViewOverride(channel, selected.id);
            if (wanted === current) return null;
            const overwrite = channel.overwrites?.find(
              (o) => o.targetType === 'role' && o.targetId === selected.id,
            );
            let allow = overwrite ? BigInt(overwrite.allow) : 0n;
            let deny = overwrite ? BigInt(overwrite.deny) : 0n;
            if (wanted === 'allow') {
              allow |= Permission.VIEW_CHANNEL;
              deny &= ~Permission.VIEW_CHANNEL;
            } else if (wanted === 'deny') {
              deny |= Permission.VIEW_CHANNEL;
              allow &= ~Permission.VIEW_CHANNEL;
            } else {
              allow &= ~Permission.VIEW_CHANNEL;
              deny &= ~Permission.VIEW_CHANNEL;
            }
            return api.put(`/channels/${channel.id}/permissions/${selected.id}`, {
              targetType: 'role',
              allow: allow.toString(),
              deny: deny.toString(),
            });
          })
          .filter((p): p is Promise<unknown> => p !== null),
      ]);
      setRoles((current) => current.map((role) => (role.id === updated.id ? updated : role)));
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

  function discard() {
    if (!selected) return;
    setDraft({
      name: selected.name,
      color: selected.color,
      hoist: selected.hoist,
      mentionable: selected.mentionable,
      permissions: selected.permissions,
      channelOverrides: buildChannelOverrides(guildState.channels, selected.id),
    });
  }

  function togglePermission(name: PermissionName, enabled: boolean) {
    if (!draft) return;
    const bit = Permission[name];
    const current = BigInt(draft.permissions);
    const next = enabled ? current | bit : current & ~bit;
    updateDraft({ permissions: next.toString() });
  }

  /**
   * "Kanalları görüntüle" ana kutusu — "tümünü seç / tümünü kaldır" gibi
   * davranır: işaretlenince temel izin AÇILIR ve HER kanala açık bir "allow"
   * yazılır; kaldırılınca temel izin KAPANIR ve HER kanala açık bir "deny"
   * yazılır. Kısmi durumdan (bazı kanallar açık, bazıları kapalı) çıkışı
   * öngörülebilir kılar — tek tek kanalları elle düzeltmeye gerek kalmaz.
   */
  function toggleViewChannelAll(enabled: boolean) {
    if (!draft) return;
    const bit = Permission.VIEW_CHANNEL;
    const current = BigInt(draft.permissions);
    const permissions = (enabled ? current | bit : current & ~bit).toString();
    const channelOverrides = new Map(draft.channelOverrides);
    for (const channel of guildState.channels) {
      if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_VOICE) continue;
      channelOverrides.set(channel.id, enabled ? 'allow' : 'deny');
    }
    updateDraft({ permissions, channelOverrides });
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
            {canEditRoleDefs && (
              <button
                type="button"
                onClick={() => void createRole()}
                className="m-2 flex items-center justify-center gap-1 rounded bg-[var(--color-brand)] px-2 py-1.5 text-sm font-medium text-black"
              >
                <Plus size={14} /> {t('roles.create')}
              </button>
            )}
          </div>

          {/* Seçili rolün ayarları */}
          <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!selected || !draft ? (
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

                {!locked && !canEditRoleDefs && (
                  <p className="mb-3 rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                    {t('roles.assignOnlyNote')}
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
                        value={draft.name}
                        disabled={locked || saving || !canEditRoleDefs}
                        onChange={(event) => updateDraft({ name: event.target.value })}
                        className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
                        {t('roles.color')}
                      </span>
                      <input
                        type="color"
                        disabled={locked || saving || !canEditRoleDefs}
                        value={`#${draft.color.toString(16).padStart(6, '0')}`}
                        onChange={(event) => updateDraft({ color: parseInt(event.target.value.slice(1), 16) })}
                        className="h-9 w-16 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] disabled:opacity-50"
                      />
                    </label>

                    <Toggle
                      label={t('roles.hoist')}
                      checked={draft.hoist}
                      disabled={locked || saving || !canEditRoleDefs}
                      onChange={(value) => updateDraft({ hoist: value })}
                    />
                    <Toggle
                      label={t('roles.mentionable')}
                      checked={draft.mentionable}
                      disabled={locked || saving || !canEditRoleDefs}
                      onChange={(value) => updateDraft({ mentionable: value })}
                    />

                    <button
                      type="button"
                      onClick={() => void deleteRole()}
                      disabled={locked || !canEditRoleDefs}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                    >
                      <Trash2 size={14} /> {t('roles.delete')}
                    </button>
                  </div>
                )}

                {(() => {
                  // VIEW_CHANNEL satırında "Kısmi" göstergesi: bu rol kanalların
                  // BAZILARINI görüp bazılarını göremiyorsa (kanal-özel overwrite
                  // taslağı yüzünden), temel izin biti tek başına yanıltıcı olur —
                  // "kapalı" görünür ama aslında bazı kanallar açık. Taslakta henüz
                  // KAYDEDİLMEMİŞ değişiklikler de (hem temel izin hem kanal
                  // overwrite'ları) hesaba katılır.
                  const relevantChannels = guildState.channels.filter(
                    (c) => c.type === ChannelType.GUILD_TEXT || c.type === ChannelType.GUILD_VOICE,
                  );
                  const visibleCount = relevantChannels.filter((c) =>
                    resolveVisible(draft.channelOverrides.get(c.id) ?? 'inherit', draft.permissions),
                  ).length;
                  const viewChannelPartial =
                    relevantChannels.length > 0 && visibleCount > 0 && visibleCount < relevantChannels.length;

                  return PERMISSION_GROUPS.map((group) => (
                  <section key={group.id} className="mb-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                      {t(`roles.groups.${group.id}`)}
                    </h3>
                    <div className="space-y-1">
                      {group.permissions.map((name) => {
                        const bit = Permission[name];
                        const isViewChannel = name === 'VIEW_CHANNEL';
                        const partial = isViewChannel && viewChannelPartial;
                        // VIEW_CHANNEL satırı "en az bir kanal görünür mü"yü
                        // yansıtır (tek tek kanal işaretlemek de ana kutuyu
                        // işaretli göstersin diye) — diğer tüm satırlar GERÇEK
                        // temel izin bitini kullanır, öngörülebilir kural.
                        const enabled = isViewChannel ? visibleCount > 0 : has(BigInt(draft.permissions), bit);
                        // Sahip olmadığın izni veremezsin (sunucu da reddeder).
                        const cannotGrant = !has(ownPermissions, bit);
                        const row = (
                          <PermissionRow
                            key={name}
                            name={t(`roles.permissions.${name}.name`)}
                            description={t(`roles.permissions.${name}.description`)}
                            danger={name === 'ADMINISTRATOR'}
                            checked={enabled}
                            partial={partial}
                            disabled={locked || saving || !canEditRoleDefs || (cannotGrant && !enabled)}
                            hint={cannotGrant && !enabled ? t('roles.cannotGrant') : undefined}
                            onChange={(value) => (isViewChannel ? toggleViewChannelAll(value) : togglePermission(name, value))}
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
                                overrides={draft.channelOverrides}
                                basePermissions={draft.permissions}
                                disabled={locked || saving || !canEditRoleDefs}
                                onToggle={(channelId, next) =>
                                  updateChannelOverride(channelId, next ? 'allow' : 'deny')
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  ));
                })()}

                {!isEveryone && <RoleMembers guildId={guildId} roleId={selected.id} locked={locked} onChanged={load} />}
              </>
            )}
          </div>

          {dirty && (
            <div className="flex items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5">
              <span className="text-sm text-[var(--color-ink-muted)]">{t('roles.unsavedChanges')}</span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={discard}
                  disabled={saving}
                  className="rounded px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                >
                  {t('roles.discard')}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || locked || !canEditRoleDefs}
                  className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
                >
                  {t('roles.save')}
                </button>
              </div>
            </div>
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
  partial,
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
  /** Rol kanalların yalnızca BİR KISMINI görebiliyor (kanal-özel overwrite'lar
   * yüzünden) — yalnızca VIEW_CHANNEL satırında true olabilir. */
  partial?: boolean;
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
          <span className={`flex items-center gap-1.5 text-sm ${danger ? 'text-[var(--color-danger)]' : ''}`}>
            {name}
            {partial && (
              <span className="text-xs font-medium text-[var(--color-brand)]">{t('roles.partial')}</span>
            )}
          </span>
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
 * ayrı bir onay kutusu. Tıklamalar artık SADECE taslağı günceller (bkz.
 * RoleDraft.channelOverrides) — sunucuya hiçbir şey yazmaz. Eskiden her
 * tıklama kendi başına anında bir PUT gönderiyordu; bu, "Kaydet" bunu hiç
 * yansıtmadığı için (dokunulmamış gibi görünüyordu) kullanıcının aynı
 * kutuya defalarca basıp kendi değişikliğini geri almasına yol açıyordu.
 */
function ChannelVisibilityPicker({
  channels,
  overrides,
  basePermissions,
  disabled,
  onToggle,
}: {
  channels: readonly APIChannel[];
  overrides: Map<string, ViewOverride>;
  basePermissions: string;
  disabled: boolean;
  onToggle: (channelId: string, next: boolean) => void;
}) {
  const { t } = useTranslation();

  const textChannels = channels
    .filter((c) => c.type === ChannelType.GUILD_TEXT)
    .sort((a, b) => a.position - b.position);
  const voiceChannels = channels
    .filter((c) => c.type === ChannelType.GUILD_VOICE)
    .sort((a, b) => a.position - b.position);

  const isVisible = (channel: APIChannel) =>
    resolveVisible(overrides.get(channel.id) ?? 'inherit', basePermissions);

  return (
    <div className="mb-2 ml-8 grid grid-cols-2 gap-4 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <ChannelVisibilityColumn
        title={t('roles.channelPicker.text')}
        channels={textChannels}
        isVisible={isVisible}
        disabled={disabled}
        onToggle={(channel, next) => onToggle(channel.id, next)}
      />
      <ChannelVisibilityColumn
        title={t('roles.channelPicker.voice')}
        channels={voiceChannels}
        isVisible={isVisible}
        disabled={disabled}
        onToggle={(channel, next) => onToggle(channel.id, next)}
      />
    </div>
  );
}

function ChannelVisibilityColumn({
  title,
  channels,
  isVisible,
  disabled,
  onToggle,
}: {
  title: string;
  channels: APIChannel[];
  isVisible: (channel: APIChannel) => boolean;
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
                disabled={disabled}
                onChange={(event) => onToggle(channel, event.target.checked)}
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
