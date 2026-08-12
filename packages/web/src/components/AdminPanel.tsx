/**
 * Platform yönetici paneli — yalnızca is_admin kullanıcılara.
 * Tüm kullanıcıları/sunucuları listeler; herhangi bir sunucuya girebilir.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, ShieldCheck, X } from 'lucide-react';
import type { APIGuild } from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore } from '../store';
import { Avatar } from './Avatar';

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
type AdminGuild = APIGuild & { memberCount: number };

interface Props {
  onClose: () => void;
}

export function AdminPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const setPendingActiveGuild = useStore((s) => s.setPendingActiveGuild);
  const [tab, setTab] = useState<'users' | 'guilds'>('users');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[] | null>(null);

  useEffect(() => {
    if (tab === 'users' && !users) {
      void api.get<AdminUser[]>('/admin/users').then(setUsers).catch(() => setUsers([]));
    }
    if (tab === 'guilds' && !guilds) {
      void api.get<AdminGuild[]>('/admin/guilds').then(setGuilds).catch(() => setGuilds([]));
    }
  }, [tab, users, guilds]);

  async function enterGuild(guildId: string) {
    await api.post(`/admin/guilds/${guildId}/join`).catch(() => undefined);
    // GUILD_CREATE olayı listeye ekleyecek; gelince store bu sunucuyu açar.
    setPendingActiveGuild(guildId);
    onClose();
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
          <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>{t('admin.tabUsers')}</TabBtn>
          <TabBtn active={tab === 'guilds'} onClick={() => setTab('guilds')}>{t('admin.tabGuilds')}</TabBtn>
        </nav>

        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'users' ? (
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
                      <div className="truncate text-xs text-[var(--color-ink-faint)]">{u.email}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {u.isAdmin && <Badge tone="brand">{t('admin.admin')}</Badge>}
                      {u.isDisabled && <Badge tone="danger">{t('admin.disabled')}</Badge>}
                      {u.deleted && <Badge tone="muted">{t('admin.deleted')}</Badge>}
                    </div>
                  </div>
                ))}
              </>
            )
          ) : guilds === null ? (
            <Loading />
          ) : (
            <>
              <div className="px-2 py-1 text-xs text-[var(--color-ink-faint)]">
                {t('admin.guildCount', { count: guilds.length })}
              </div>
              {guilds.map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--color-surface-2)]">
                  <Avatar name={g.name} avatarUrl={g.iconUrl} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.name}</div>
                    <div className="text-xs text-[var(--color-ink-faint)]">
                      {t('admin.members', { count: g.memberCount })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void enterGuild(g.id)}
                    title={t('admin.joinGuild')}
                    className="flex items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]"
                  >
                    <LogIn size={13} /> {t('admin.joinGuild')}
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
