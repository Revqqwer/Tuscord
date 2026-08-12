/**
 * Kanal ayarları modalı — kanala sağ tık → Ayarlar.
 *
 * İki sekme:
 *  - Genel: ad, konu, yavaş mod, NSFW, kilit, sil
 *  - İzinler: rol/üye bazında overwrite matrisi (miras / izin ver / engelle)
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, Minus, Plus, Trash2, X } from 'lucide-react';
import {
  Limits,
  Permission,
  has,
  type APIChannel,
  type APIPermissionOverwrite,
  type APIRole,
  type PermissionName,
} from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore } from '../store';

interface Props {
  channel: APIChannel;
  roles: APIRole[];
  onClose: () => void;
}

/** İzin ekranında gösterilecek anahtarlar (en sık kullanılanlar). */
const OVERWRITE_PERMS: PermissionName[] = [
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'READ_MESSAGE_HISTORY',
  'ATTACH_FILES',
  'ADD_REACTIONS',
  'MANAGE_MESSAGES',
  'CONNECT',
  'SPEAK',
];

type TriState = 'inherit' | 'allow' | 'deny';

export function ChannelSettings({ channel, roles, onClose }: Props) {
  const { t } = useTranslation();
  const upsertChannel = useStore((s) => s.upsertChannel);
  const removeChannel = useStore((s) => s.removeChannel);

  const [tab, setTab] = useState<'overview' | 'perms'>('overview');
  const [name, setName] = useState(channel.name ?? '');
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [slowmode, setSlowmode] = useState(channel.slowmodeSeconds);
  const [nsfw, setNsfw] = useState(channel.nsfw);
  const [locked, setLocked] = useState(channel.locked);
  const [overwrites, setOverwrites] = useState<APIPermissionOverwrite[]>(channel.overwrites ?? []);
  const [saving, setSaving] = useState(false);

  // Overwrite'lar yalnızca MANAGE_CHANNELS ile geliyordu; yoksa tazele.
  useEffect(() => {
    if (!channel.overwrites) {
      void api
        .get<APIChannel>(`/channels/${channel.id}`)
        .then((c) => setOverwrites(c.overwrites ?? []))
        .catch(() => undefined);
    }
  }, [channel.id]);

  async function saveOverview() {
    setSaving(true);
    try {
      const updated = await api.patch<APIChannel>(`/channels/${channel.id}`, {
        name,
        topic: topic || null,
        slowmodeSeconds: slowmode,
        nsfw,
        locked,
      });
      upsertChannel(updated);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm(t('channelSettings.deleteConfirm', { name: channel.name }))) return;
    await api.delete(`/channels/${channel.id}`);
    if (channel.guildId) removeChannel(channel.guildId, channel.id);
    onClose();
  }

  /** Bir hedef (rol/üye) için tek iznin üç durumu döngüsü. */
  async function cycle(targetId: string, targetType: 'role' | 'member', name: PermissionName) {
    const bit = Permission[name];
    const current = overwrites.find((o) => o.targetId === targetId && o.targetType === targetType);
    let allow = current ? BigInt(current.allow) : 0n;
    let deny = current ? BigInt(current.deny) : 0n;

    const state: TriState = has(allow, bit) ? 'allow' : has(deny, bit) ? 'deny' : 'inherit';
    // inherit → allow → deny → inherit
    if (state === 'inherit') {
      allow |= bit;
    } else if (state === 'allow') {
      allow &= ~bit;
      deny |= bit;
    } else {
      deny &= ~bit;
    }

    if (allow === 0n && deny === 0n) {
      await api.delete(`/channels/${channel.id}/permissions/${targetId}`);
      setOverwrites((cur) => cur.filter((o) => !(o.targetId === targetId && o.targetType === targetType)));
    } else {
      await api.put(`/channels/${channel.id}/permissions/${targetId}`, {
        targetType,
        allow: allow.toString(),
        deny: deny.toString(),
      });
      setOverwrites((cur) => {
        const next = cur.filter((o) => !(o.targetId === targetId && o.targetType === targetType));
        next.push({ targetId, targetType, allow: allow.toString(), deny: deny.toString() });
        return next;
      });
    }
  }

  // Overwrite'ı olan roller + eklenebilecek roller.
  const rolesWithOverwrite = roles.filter((r) =>
    overwrites.some((o) => o.targetId === r.id && o.targetType === 'role'),
  );
  const addableRoles = roles.filter(
    (r) => !overwrites.some((o) => o.targetId === r.id && o.targetType === 'role'),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('channelSettings.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Hash size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="font-medium">{channel.name}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-[var(--color-line)] px-4">
          <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')}>
            {t('channelSettings.overview')}
          </TabBtn>
          <TabBtn active={tab === 'perms'} onClick={() => setTab('perms')}>
            {t('channelSettings.permissions')}
          </TabBtn>
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'overview' ? (
            <div className="space-y-4">
              <Field label={t('channelSettings.name')}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
                />
              </Field>
              <Field label={t('channelSettings.topic')}>
                <textarea
                  value={topic}
                  rows={2}
                  maxLength={Limits.CHANNEL_TOPIC_MAX}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
                />
              </Field>
              <Field label={t('channelSettings.slowmode')}>
                <input
                  type="number"
                  min={0}
                  max={Limits.SLOWMODE_MAX_SECONDS}
                  value={slowmode}
                  onChange={(e) => setSlowmode(Number(e.target.value))}
                  className="w-32 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
                />
              </Field>
              <Toggle label={t('channelSettings.nsfw')} checked={nsfw} onChange={setNsfw} />
              <Toggle label={t('channelSettings.locked')} checked={locked} onChange={setLocked} />

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void saveOverview()}
                  disabled={saving}
                  className="rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => void del()}
                  className="ml-auto flex items-center gap-1 rounded px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                >
                  <Trash2 size={14} /> {t('channelSettings.delete')}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-xs text-[var(--color-ink-faint)]">{t('channelSettings.overwriteHint')}</p>

              {rolesWithOverwrite.map((role) => (
                <OverwriteRow
                  key={role.id}
                  label={role.id === channel.guildId ? '@everyone' : role.name}
                  color={role.color}
                  overwrite={overwrites.find((o) => o.targetId === role.id)!}
                  onCycle={(perm) => void cycle(role.id, 'role', perm)}
                />
              ))}

              {addableRoles.length > 0 && (
                <div className="mt-3">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const roleId = e.target.value;
                      e.target.value = '';
                      if (roleId) void cycle(roleId, 'role', 'VIEW_CHANNEL');
                    }}
                    className="rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      {t('channelSettings.addOverwrite')}
                    </option>
                    {addableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id === channel.guildId ? '@everyone' : r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverwriteRow({
  label,
  color,
  overwrite,
  onCycle,
}: {
  label: string;
  color: number;
  overwrite: APIPermissionOverwrite;
  onCycle: (perm: PermissionName) => void;
}) {
  const { t } = useTranslation();
  const allow = BigInt(overwrite.allow);
  const deny = BigInt(overwrite.deny);

  return (
    <div className="mb-3 rounded border border-[var(--color-line)] p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: color ? `#${color.toString(16).padStart(6, '0')}` : 'var(--color-ink-faint)' }}
        />
        {label}
      </div>
      <div className="space-y-1">
        {OVERWRITE_PERMS.map((perm) => {
          const bit = Permission[perm];
          const state: TriState = has(allow, bit) ? 'allow' : has(deny, bit) ? 'deny' : 'inherit';
          return (
            <div key={perm} className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink-muted)]">{t(`roles.permissions.${perm}.name`)}</span>
              <button
                type="button"
                onClick={() => onCycle(perm)}
                title={state}
                className={`flex h-6 w-6 items-center justify-center rounded ${
                  state === 'allow'
                    ? 'bg-[var(--color-online)]/25 text-[var(--color-online)]'
                    : state === 'deny'
                      ? 'bg-[var(--color-danger)]/25 text-[var(--color-danger)]'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-ink-faint)]'
                }`}
              >
                {state === 'allow' ? <Plus size={14} /> : state === 'deny' ? <X size={14} /> : <Minus size={14} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm ${
        active ? 'border-[var(--color-brand)] text-[var(--color-ink)]' : 'border-transparent text-[var(--color-ink-muted)]'
      }`}
    >
      {children}
    </button>
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
      {label}
    </label>
  );
}
