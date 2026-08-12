/**
 * Arkadaş paneli — etiketle ekleme, bekleyen istekler, arkadaş listesi.
 *
 * Etiket = kullanıcıadı#dördül (Discord modeli). Kendi etiketin üstte gösterilir
 * ki arkadaşlarına verebilesin.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MessageSquare, UserPlus, X } from 'lucide-react';
import type { APIFriendship, SelfUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore } from '../store';
import { Avatar } from './Avatar';

interface Props {
  self: SelfUser;
  onClose: () => void;
  onMessage: (userId: string) => void;
}

export function FriendsPanel({ self, onClose, onMessage }: Props) {
  const { t } = useTranslation();
  const friends = useStore((state) => state.friends);
  const upsertFriend = useStore((state) => state.upsertFriend);
  const removeFriend = useStore((state) => state.removeFriend);

  const [tab, setTab] = useState<'all' | 'pending'>('all');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accepted = friends.filter((f) => f.status === 'accepted');
  const pending = friends.filter((f) => f.status === 'pending');

  async function sendRequest() {
    const value = tag.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const friend = await api.post<APIFriendship>('/users/@me/friends', { tag: value });
      upsertFriend(friend);
      setTag('');
      setStatus(friend.status === 'accepted' ? t('friends.accept') : t('friends.sent'));
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      const key = `friends.errors.${code}`;
      const translated = t(key);
      setError(translated === key ? t('common.error') : translated);
    } finally {
      setBusy(false);
    }
  }

  async function accept(userId: string) {
    const friend = await api.put<APIFriendship>(`/users/@me/friends/${userId}`).catch(() => null);
    if (friend) upsertFriend(friend);
  }

  async function drop(userId: string, confirmFirst: boolean) {
    if (confirmFirst && !confirm(t('friends.removeConfirm'))) return;
    await api.delete(`/users/@me/friends/${userId}`).catch(() => undefined);
    removeFriend(userId);
  }

  const list = tab === 'all' ? accepted : pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('friends.title')}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[80vh] w-full max-w-md flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <UserPlus size={18} className="text-[var(--color-brand)]" />
          <h2 className="font-medium">{t('friends.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        {/* Ekleme */}
        <div className="border-b border-[var(--color-line)] p-4">
          <div className="mb-1.5 text-xs text-[var(--color-ink-muted)]">
            {t('friends.myTag')}:{' '}
            <span className="font-mono text-[var(--color-brand)]">
              {self.username}#{self.discriminator}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendRequest();
              }}
              placeholder={t('friends.addPlaceholder')}
              className="flex-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
            />
            <button
              type="button"
              onClick={() => void sendRequest()}
              disabled={busy || tag.trim().length === 0}
              className="rounded bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {t('friends.send')}
            </button>
          </div>
          {status && <p className="mt-1.5 text-xs text-[var(--color-online)]">{status}</p>}
          {error && <p className="mt-1.5 text-xs text-[var(--color-danger)]">{error}</p>}
        </div>

        {/* Sekmeler */}
        <div className="flex gap-1 border-b border-[var(--color-line)] px-4">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            {t('friends.tabAll')} ({accepted.length})
          </TabButton>
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            {t('friends.tabPending')}
            {pending.length > 0 && (
              <span className="ml-1 rounded-full bg-[var(--color-dnd)] px-1.5 text-xs text-white">
                {pending.length}
              </span>
            )}
          </TabButton>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">
              {tab === 'all' ? t('friends.emptyFriends') : t('friends.emptyPending')}
            </p>
          ) : (
            list.map((f) => (
              <div
                key={f.user.id}
                className="flex items-center gap-3 rounded px-2 py-2 hover:bg-[var(--color-surface-2)]"
              >
                <Avatar
                  name={f.user.displayName ?? f.user.username}
                  avatarUrl={f.user.avatarUrl}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {f.user.displayName ?? f.user.username}
                  </div>
                  <div className="truncate text-xs text-[var(--color-ink-faint)]">
                    {f.status === 'pending'
                      ? f.direction === 'incoming'
                        ? t('friends.incoming')
                        : t('friends.outgoing')
                      : `${f.user.username}#${f.user.discriminator}`}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {f.status === 'accepted' && (
                    <IconBtn label={t('friends.message')} onClick={() => onMessage(f.user.id)}>
                      <MessageSquare size={16} />
                    </IconBtn>
                  )}
                  {f.status === 'pending' && f.direction === 'incoming' && (
                    <IconBtn label={t('friends.accept')} tone="ok" onClick={() => void accept(f.user.id)}>
                      <Check size={16} />
                    </IconBtn>
                  )}
                  <IconBtn
                    label={f.status === 'accepted' ? t('friends.remove') : t('friends.reject')}
                    tone="danger"
                    onClick={() => void drop(f.user.id, f.status === 'accepted')}
                  >
                    <X size={16} />
                  </IconBtn>
                </div>
              </div>
            ))
          )}
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
      className={`flex items-center border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-[var(--color-brand)] text-[var(--color-ink)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'ok' | 'danger';
  children: React.ReactNode;
}) {
  const color =
    tone === 'ok'
      ? 'text-[var(--color-online)]'
      : tone === 'danger'
        ? 'text-[var(--color-danger)]'
        : 'text-[var(--color-ink-muted)]';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1.5 hover:bg-[var(--color-surface-3)] ${color}`}
    >
      {children}
    </button>
  );
}
