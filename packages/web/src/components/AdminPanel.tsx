/**
 * Platform yönetici paneli — yalnızca is_admin kullanıcılara.
 * Tüm kullanıcıları/sunucuları listeler; herhangi bir sunucuya girebilir.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Ban,
  Flame,
  LogIn,
  Server,
  ShieldCheck,
  Trash2,
  Trophy,
  Users as UsersIcon,
  X,
  Zap,
} from 'lucide-react';
import type { APIGuild, APIGuildMember, APIRole } from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { initialsFromName } from '../lib/initials';

interface AdminUser {
  id: string;
  username: string;
  discriminator: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  isDisabled: boolean;
  deleted: boolean;
  createdAt: string;
}
type AdminGuild = APIGuild & { memberCount: number; storageBytes: number };
interface AdminGuildMembers {
  roles: APIRole[];
  members: APIGuildMember[];
}
interface AdminSummary {
  totalUsers: number;
  totalGuilds: number;
  activeUsersNow: number;
  dailyPeakActiveUsers: number;
  allTimePeakActiveUsers: number;
}

/** İnsan-okunur boyut — 0 B'den TB'ye, admin panelinde disk kullanımı için. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}

/** Kısa, yerel tarih — üyelik/oluşturma tarihi rozetleri için. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
  onClose: () => void;
}

export function AdminPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const setPendingActiveGuild = useStore((s) => s.setPendingActiveGuild);
  const [tab, setTab] = useState<'summary' | 'users' | 'guilds'>('summary');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[] | null>(null);
  /** Detayına girilen sunucu — dropdown gibi, aynı panelde üye+rol listesine geçer. */
  const [drilldownGuild, setDrilldownGuild] = useState<AdminGuild | null>(null);
  const [drilldown, setDrilldown] = useState<AdminGuildMembers | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'summary') {
      // Sekmeye her dönüşte tazelenir — "şu an aktif" canlı bir sayı,
      // eskiyen bir önbellek göstermek yanıltıcı olur.
      void api.get<AdminSummary>('/admin/summary').then(setSummary).catch(() => undefined);
    }
    if (tab === 'users' && !users) {
      void api.get<AdminUser[]>('/admin/users').then(setUsers).catch(() => setUsers([]));
    }
    if (tab === 'guilds' && !guilds) {
      void api.get<AdminGuild[]>('/admin/guilds').then(setGuilds).catch(() => setGuilds([]));
    }
  }, [tab, users, guilds]);

  useEffect(() => {
    if (!drilldownGuild) {
      setDrilldown(null);
      return;
    }
    void api
      .get<AdminGuildMembers>(`/admin/guilds/${drilldownGuild.id}/members`)
      .then(setDrilldown)
      .catch(() => setDrilldown({ roles: [], members: [] }));
  }, [drilldownGuild]);

  async function enterGuild(guildId: string) {
    await api.post(`/admin/guilds/${guildId}/join`).catch(() => undefined);
    // GUILD_CREATE olayı listeye ekleyecek; gelince store bu sunucuyu açar.
    setPendingActiveGuild(guildId);
    onClose();
  }

  async function toggleBan(u: AdminUser) {
    setBusyId(u.id);
    try {
      await api.patch(`/admin/users/${u.id}/ban`, { banned: !u.isDisabled });
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, isDisabled: !u.isDisabled } : x)) ?? list);
    } catch {
      // 400 (yönetici/kendisi) — düğme zaten bu durumlar için gizli/pasif.
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(t('admin.deleteUserConfirm', { name: u.displayName ?? u.username }))) return;
    setBusyId(u.id);
    try {
      await api.post(`/admin/users/${u.id}/delete`);
      setUsers(
        (list) => list?.map((x) => (x.id === u.id ? { ...x, deleted: true, isDisabled: true } : x)) ?? list,
      );
    } catch {
      // 400 — düğme zaten gizli/pasif olmalı.
    } finally {
      setBusyId(null);
    }
  }

  async function deleteGuild(g: AdminGuild) {
    if (!confirm(t('admin.deleteGuildConfirm', { name: g.name }))) return;
    setBusyId(g.id);
    try {
      await api.delete(`/admin/guilds/${g.id}`);
      setGuilds((list) => list?.filter((x) => x.id !== g.id) ?? list);
      if (drilldownGuild?.id === g.id) setDrilldownGuild(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('admin.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <ShieldCheck size={18} className="text-[var(--color-brand)]" />
          <h2 className="font-medium">{t('admin.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <X size={18} />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-[var(--color-line)] px-4">
          <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>{t('admin.tabSummary')}</TabBtn>
          <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>{t('admin.tabUsers')}</TabBtn>
          <TabBtn active={tab === 'guilds'} onClick={() => setTab('guilds')}>{t('admin.tabGuilds')}</TabBtn>
        </nav>

        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'summary' ? (
            summary === null ? (
              <Loading />
            ) : (
              <div className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-3">
                <SummaryTile
                  icon={<UsersIcon size={18} />}
                  tone="neutral"
                  label={t('admin.summary.totalUsers')}
                  value={summary.totalUsers}
                />
                <SummaryTile
                  icon={<Server size={18} />}
                  tone="neutral"
                  label={t('admin.summary.totalGuilds')}
                  value={summary.totalGuilds}
                />
                <SummaryTile
                  icon={<Zap size={18} />}
                  tone="online"
                  label={t('admin.summary.activeNow')}
                  value={summary.activeUsersNow}
                />
                <SummaryTile
                  icon={<Flame size={18} />}
                  tone="idle"
                  label={t('admin.summary.dailyPeak')}
                  value={summary.dailyPeakActiveUsers}
                />
                <SummaryTile
                  icon={<Trophy size={18} />}
                  tone="brand"
                  label={t('admin.summary.allTimePeak')}
                  value={summary.allTimePeakActiveUsers}
                />
              </div>
            )
          ) : tab === 'users' ? (
            users === null ? (
              <Loading />
            ) : (
              <>
                <div className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">
                  {t('admin.userCount', { count: users.length })}
                </div>
                {users.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--color-surface-2)]">
                    <Avatar name={u.displayName ?? u.username} avatarUrl={u.avatarUrl} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {u.displayName ?? u.username}
                        <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
                          {u.username}#{u.discriminator}
                        </span>
                      </div>
                      <div className="truncate text-xs text-[var(--color-ink-faint)]">
                        {u.email} · {t('admin.joinedAt', { date: formatDate(u.createdAt) })}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {u.isAdmin && <Badge tone="brand">{t('admin.admin')}</Badge>}
                      {u.isDisabled && <Badge tone="danger">{t('admin.disabled')}</Badge>}
                      {u.deleted && <Badge tone="muted">{t('admin.deleted')}</Badge>}
                      {!u.isAdmin && !u.deleted && (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleBan(u)}
                            disabled={busyId === u.id}
                            title={u.isDisabled ? t('admin.unban') : t('admin.ban')}
                            className={`rounded p-1.5 hover:bg-[var(--color-surface-3)] disabled:opacity-40 ${
                              u.isDisabled ? 'text-[var(--color-online)]' : 'text-[var(--color-idle)]'
                            }`}
                          >
                            <Ban size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteUser(u)}
                            disabled={busyId === u.id}
                            title={t('admin.deleteUser')}
                            className="rounded p-1.5 text-[var(--color-danger)] hover:bg-[var(--color-surface-3)] disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )
          ) : drilldownGuild ? (
            <>
              <button
                type="button"
                onClick={() => setDrilldownGuild(null)}
                className="mb-2 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              >
                <ArrowLeft size={13} /> {t('admin.backToGuilds')}
              </button>
              <div className="mb-2 flex items-center gap-3 px-2">
                <Avatar name={drilldownGuild.name} avatarUrl={drilldownGuild.iconUrl} size={32} initials={initialsFromName(drilldownGuild.name)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{drilldownGuild.name}</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">
                    {t('admin.members', { count: drilldownGuild.memberCount })} ·{' '}
                    {t('admin.storage', { size: formatBytes(drilldownGuild.storageBytes) })} ·{' '}
                    {t('admin.createdAt', { date: formatDate(drilldownGuild.createdAt) })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteGuild(drilldownGuild)}
                  disabled={busyId === drilldownGuild.id}
                  title={t('admin.deleteGuild')}
                  className="flex shrink-0 items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-40"
                >
                  <Trash2 size={13} /> {t('admin.deleteGuild')}
                </button>
              </div>
              {drilldown === null ? (
                <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">
                  {t('admin.loadingMembers')}
                </p>
              ) : (
                drilldown.members.map((m) => {
                  const memberRoleNames = drilldown.roles
                    .filter((r) => m.roles.includes(r.id) && r.id !== drilldownGuild.id)
                    .sort((a, b) => b.position - a.position);
                  return (
                    <div
                      key={m.user.id}
                      className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--color-surface-2)]"
                    >
                      <Avatar name={m.nickname ?? m.user.displayName ?? m.user.username} avatarUrl={m.user.avatarUrl} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {m.nickname ?? m.user.displayName ?? m.user.username}
                          <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
                            {m.user.username}#{m.user.discriminator}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 text-xs text-[var(--color-ink-faint)]">
                          {memberRoleNames.length > 0
                            ? memberRoleNames.map((r) => (
                                <span key={r.id} className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5">
                                  {r.name}
                                </span>
                              ))
                            : t('admin.noRoles')}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          ) : guilds === null ? (
            <Loading />
          ) : (
            <>
              <div className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">
                {t('admin.guildCount', { count: guilds.length })}
              </div>
              {guilds.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--color-surface-2)]">
                  <button
                    type="button"
                    onClick={() => setDrilldownGuild(g)}
                    title={t('admin.viewMembers')}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar name={g.name} avatarUrl={g.iconUrl} size={32} initials={initialsFromName(g.name)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{g.name}</div>
                      <div className="text-xs text-[var(--color-ink-faint)]">
                        {t('admin.members', { count: g.memberCount })} ·{' '}
                        {t('admin.storage', { size: formatBytes(g.storageBytes) })} ·{' '}
                        {t('admin.createdAt', { date: formatDate(g.createdAt) })}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void enterGuild(g.id)}
                    title={t('admin.joinGuild')}
                    className="flex shrink-0 items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]"
                  >
                    <LogIn size={13} /> {t('admin.joinGuild')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteGuild(g)}
                    disabled={busyId === g.id}
                    title={t('admin.deleteGuild')}
                    className="flex shrink-0 items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-[var(--color-brand)] text-[var(--color-ink)]' : 'border-transparent text-[var(--color-ink-muted)]'}`}>
      {children}
    </button>
  );
}
function Badge({ tone, children }: { tone: 'brand' | 'danger' | 'muted'; children: React.ReactNode }) {
  const c = tone === 'brand' ? 'text-[var(--color-brand)]' : tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-faint)]';
  return <span className={`rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-semibold uppercase ${c}`}>{children}</span>;
}
function Loading() {
  const { t } = useTranslation();
  return <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>;
}
const SUMMARY_TONES = {
  neutral: { fg: 'text-[var(--color-ink)]', badge: 'bg-[var(--color-surface-3)] text-[var(--color-ink-muted)]' },
  brand: { fg: 'text-[var(--color-brand)]', badge: 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]' },
  online: { fg: 'text-[var(--color-online)]', badge: 'bg-[var(--color-online)]/15 text-[var(--color-online)]' },
  idle: { fg: 'text-[var(--color-idle)]', badge: 'bg-[var(--color-idle)]/15 text-[var(--color-idle)]' },
} as const;

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof SUMMARY_TONES;
}) {
  const { fg, badge } = SUMMARY_TONES[tone];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${badge}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-2xl font-semibold leading-tight ${fg}`}>{value.toLocaleString('tr')}</div>
        <div className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{label}</div>
      </div>
    </div>
  );
}
