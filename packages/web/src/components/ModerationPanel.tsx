/**
 * Moderasyon paneli — spec Bölüm 8'in arayüz karşılığı.
 *
 * Tasarım hedefi: bir şikayet geldiğinde sahibin **tek ekranda** görüp
 * dakikalar içinde işlem yapabilmesi. Üç sekme: rapor kuyruğu, üyeler,
 * denetim kaydı.
 *
 * Her düğme, kullanıcının o an sahip olduğu izne göre görünür. Bu yalnızca
 * arayüz kolaylığı; sunucu her isteği yeniden doğruluyor.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Gavel, ScrollText, ShieldAlert, UserMinus, X } from 'lucide-react';
import { Permission, type APIGuildMember } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore, type GuildState } from '../store';
import { can } from '../lib/permissions';

interface Report {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  snapshot: { content?: string; authorId?: string } | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  actorId: string;
  actionType: string;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
}

type Tab = 'reports' | 'members' | 'audit';

interface Props {
  guildState: GuildState;
  onClose: () => void;
}

export function ModerationPanel({ guildState, onClose }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('reports');
  const permissions = BigInt(guildState.permissions);

  const canBan = can(permissions, Permission.BAN_MEMBERS);
  const canKick = can(permissions, Permission.KICK_MEMBERS);
  const canTimeout = can(permissions, Permission.MODERATE_MEMBERS);
  const canViewAudit = can(permissions, Permission.VIEW_AUDIT_LOG);
  const canViewReports = canBan || can(permissions, Permission.MANAGE_GUILD);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('moderation.title')}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <ShieldAlert size={18} className="text-[var(--color-brand)]" />
          <h2 className="font-medium">{t('moderation.title')}</h2>
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

        <nav className="flex gap-1 border-b border-[var(--color-line)] px-4">
          {canViewReports && (
            <TabButton active={tab === 'reports'} onClick={() => setTab('reports')}>
              {t('moderation.tabs.reports')}
            </TabButton>
          )}
          <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
            {t('moderation.tabs.members')}
          </TabButton>
          {canViewAudit && (
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
              {t('moderation.tabs.audit')}
            </TabButton>
          )}
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'reports' && canViewReports && <ReportsTab guildId={guildState.guild.id} />}
          {tab === 'members' && (
            <MembersTab
              guildState={guildState}
              canBan={canBan}
              canKick={canKick}
              canTimeout={canTimeout}
            />
          )}
          {tab === 'audit' && canViewAudit && <AuditTab guildId={guildState.guild.id} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-[var(--color-brand)] text-[var(--color-ink)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function ReportsTab({ guildId }: { guildId: string }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState<Report[] | null>(null);

  async function load() {
    const data = await api.get<Report[]>(`/guilds/${guildId}/reports`).catch(() => []);
    setReports(data);
  }

  useEffect(() => {
    void load();
  }, [guildId]);

  async function setStatus(id: string, status: Report['status']) {
    await api.patch(`/guilds/${guildId}/reports/${id}`, { status });
    await load();
  }

  if (reports === null) return <Loading />;
  const open = reports.filter((report) => report.status === 'open' || report.status === 'in_review');
  if (open.length === 0) return <Empty text={t('moderation.noReports')} />;

  return (
    <ul className="space-y-3">
      {open.map((report) => (
        <li key={report.id} className="rounded border border-[var(--color-line)] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
            <span className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5">
              {report.targetType}
            </span>
            <span>{new Date(report.createdAt).toLocaleString('tr')}</span>
          </div>

          <p className="mb-2 text-sm">{report.reason}</p>

          {report.snapshot?.content && (
            <blockquote className="mb-2 border-l-2 border-[var(--color-line)] pl-2 text-sm text-[var(--color-ink-muted)]">
              {report.snapshot.content}
            </blockquote>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void setStatus(report.id, 'resolved')}
              className="rounded bg-[var(--color-brand)] px-2 py-1 text-xs font-medium text-black"
            >
              {t('moderation.markResolved')}
            </button>
            <button
              type="button"
              onClick={() => void setStatus(report.id, 'dismissed')}
              className="rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs"
            >
              {t('moderation.markDismissed')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

function MembersTab({
  guildState,
  canBan,
  canKick,
  canTimeout,
}: {
  guildState: GuildState;
  canBan: boolean;
  canKick: boolean;
  canTimeout: boolean;
}) {
  const { t } = useTranslation();
  const members = useStore((state) => state.members.get(guildState.guild.id) ?? []);
  const setMembers = useStore((state) => state.setMembers);
  const [error, setError] = useState<string | null>(null);
  const guildId = guildState.guild.id;

  async function refresh() {
    const list = await api
      .get<APIGuildMember[]>(`/guilds/${guildId}/members?limit=200`)
      .catch(() => []);
    setMembers(guildId, list);
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      // Rol hiyerarşisi ihlali en sık görülen ret sebebi; kullanıcıya sebebi söyle.
      setError(
        caught instanceof ApiError && caught.code === 'role_hierarchy'
          ? t('moderation.hierarchyBlocked')
          : caught instanceof ApiError
            ? caught.message
            : t('common.error'),
      );
    }
  }

  const displayName = (member: APIGuildMember) =>
    member.nickname ?? member.user.displayName ?? member.user.username;

  return (
    <>
      {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      <ul className="space-y-1">
        {members.map((member) => {
          const isOwner = member.user.id === guildState.guild.ownerId;
          const timedOut =
            member.timeoutUntil !== null && new Date(member.timeoutUntil).getTime() > Date.now();

          return (
            <li
              key={member.user.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-xs">
                {displayName(member).slice(0, 2).toLocaleUpperCase('tr')}
              </span>
              <span className="truncate text-sm">{displayName(member)}</span>
              {isOwner && <Gavel size={12} className="text-[var(--color-idle)]" />}
              {timedOut && (
                <span className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-xs text-[var(--color-idle)]">
                  {t('moderation.timedOut')}
                </span>
              )}

              {!isOwner && (
                <div className="ml-auto flex items-center gap-1">
                  {canTimeout && (
                    <select
                      aria-label={t('moderation.timeout')}
                      defaultValue=""
                      onChange={(event) => {
                        const minutes = Number(event.target.value);
                        event.target.value = '';
                        void run(() =>
                          api.put(`/guilds/${guildId}/members/${member.user.id}/timeout`, {
                            minutes,
                          }),
                        );
                      }}
                      className="rounded bg-[var(--color-surface-3)] px-1.5 py-1 text-xs"
                    >
                      <option value="" disabled>
                        {t('moderation.timeout')}
                      </option>
                      <option value="5">{t('moderation.timeoutOptions.m5')}</option>
                      <option value="60">{t('moderation.timeoutOptions.h1')}</option>
                      <option value="1440">{t('moderation.timeoutOptions.d1')}</option>
                      <option value="10080">{t('moderation.timeoutOptions.d7')}</option>
                      <option value="0">{t('moderation.timeoutOptions.clear')}</option>
                    </select>
                  )}

                  {canKick && (
                    <IconButton
                      label={t('moderation.kick')}
                      onClick={() => {
                        if (!confirm(t('moderation.confirmKick', { name: displayName(member) })))
                          return;
                        void run(() => api.delete(`/guilds/${guildId}/members/${member.user.id}`));
                      }}
                    >
                      <UserMinus size={14} />
                    </IconButton>
                  )}

                  {canBan && (
                    <IconButton
                      label={t('moderation.ban')}
                      danger
                      onClick={() => {
                        if (!confirm(t('moderation.confirmBan', { name: displayName(member) })))
                          return;
                        void run(() =>
                          api.put(`/guilds/${guildId}/bans/${member.user.id}`, {
                            deleteMessageDays: 1,
                          }),
                        );
                      }}
                    >
                      <Ban size={14} />
                    </IconButton>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1.5 transition hover:bg-[var(--color-surface-3)] ${
        danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function AuditTab({ guildId }: { guildId: string }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    void api
      .get<AuditEntry[]>(`/guilds/${guildId}/audit-log?limit=100`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [guildId]);

  if (entries === null) return <Loading />;
  if (entries.length === 0) return <Empty text={t('moderation.auditLog')} />;

  return (
    <ul className="space-y-1 text-sm">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
        >
          <ScrollText size={14} className="shrink-0 text-[var(--color-ink-faint)]" />
          <span className="font-mono text-xs text-[var(--color-brand)]">{entry.actionType}</span>
          {entry.targetId && (
            <span className="text-xs text-[var(--color-ink-muted)]">→ {entry.targetId}</span>
          )}
          {entry.reason && (
            <span className="truncate text-xs text-[var(--color-ink-muted)]">{entry.reason}</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-faint)]">
            {new Date(entry.createdAt).toLocaleString('tr')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Loading() {
  const { t } = useTranslation();
  return <p className="text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>;
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-[var(--color-ink-faint)]">{text}</p>;
}
