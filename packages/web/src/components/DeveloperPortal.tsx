/**
 * Geliştirici portalı — bot uygulamaları oluşturma/yönetme.
 *
 * Discord'un Developer Portal'ına bilinçli paralellik: bir "uygulama"
 * oluşturursun, arkasında ayrı bir bot kullanıcı + token vardır. Token
 * yalnızca oluşturma/yenileme anında BİR KEZ gösterilir — sonra yalnızca
 * hash'i sunucuda durur (bkz. server auth/bot.ts).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Copy, KeyRound, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  ALL_PERMISSIONS,
  Limits,
  PERMISSION_GROUPS,
  Permission,
  has,
  type APIBotApplication,
  type APIBotApplicationWithToken,
} from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { Avatar } from './Avatar';
import { initialsFromName } from '../lib/initials';

interface Props {
  onClose: () => void;
}

export function DeveloperPortal({ onClose }: Props) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<APIBotApplication[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Yeni oluşturulan/yenilenen token — bir kez gösterilir, sonra kaybolur. */
  const [revealedToken, setRevealedToken] = useState<{ appId: string; token: string } | null>(null);
  const [inviteApp, setInviteApp] = useState<APIBotApplication | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    void api.get<APIBotApplication[]>('/developers/applications').then(setApps).catch(() => setApps([]));
  }, []);

  async function createApp() {
    const name = newName.trim();
    if (name.length < 2) return;
    setError(null);
    try {
      const created = await api.post<APIBotApplicationWithToken>('/developers/applications', { name });
      setApps((list) => [...(list ?? []), created]);
      setRevealedToken({ appId: created.id, token: created.token });
      setCreating(false);
      setNewName('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  async function resetToken(app: APIBotApplication) {
    if (!confirm(t('developers.resetTokenConfirm', { name: app.name }))) return;
    setBusyId(app.id);
    try {
      const updated = await api.post<APIBotApplicationWithToken>(`/developers/applications/${app.id}/reset-token`);
      setRevealedToken({ appId: app.id, token: updated.token });
    } catch {
      // sessiz geç — kullanıcı tekrar dener
    } finally {
      setBusyId(null);
    }
  }

  async function rename(app: APIBotApplication) {
    const name = renameValue.trim();
    if (name.length < 2 || name === app.name) {
      setRenamingId(null);
      return;
    }
    setBusyId(app.id);
    try {
      const updated = await api.patch<APIBotApplication>(`/developers/applications/${app.id}`, { name });
      setApps((list) => list?.map((a) => (a.id === app.id ? updated : a)) ?? list);
    } catch {
      // sessiz geç
    } finally {
      setBusyId(null);
      setRenamingId(null);
    }
  }

  async function deleteApp(app: APIBotApplication) {
    if (!confirm(t('developers.deleteConfirm', { name: app.name }))) return;
    setBusyId(app.id);
    try {
      await api.delete(`/developers/applications/${app.id}`);
      setApps((list) => list?.filter((a) => a.id !== app.id) ?? list);
      if (inviteApp?.id === app.id) setInviteApp(null);
    } catch {
      // sessiz geç
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('developers.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[82vh] w-full max-w-2xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Bot size={18} className="text-[var(--color-brand)]" />
          <h2 className="font-medium">{t('developers.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {inviteApp ? (
            <InviteLinkBuilder app={inviteApp} onBack={() => setInviteApp(null)} />
          ) : (
            <>
              <p className="mb-3 px-1 text-xs text-[var(--color-ink-faint)]">{t('developers.intro')}</p>

              {apps === null ? (
                <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>
              ) : (
                <div className="space-y-1">
                  {apps.map((app) => (
                    <div key={app.id} className="rounded px-2 py-2 hover:bg-[var(--color-surface-2)]">
                      <div className="flex items-center gap-3">
                        <Avatar name={app.name} avatarUrl={app.botUser.avatarUrl} size={32} initials={initialsFromName(app.name)} />
                        <div className="min-w-0 flex-1">
                          {renamingId === app.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              maxLength={Limits.BOT_NAME_MAX}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && void rename(app)}
                              onBlur={() => void rename(app)}
                              className="w-full rounded border border-[var(--color-brand)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-sm outline-none"
                            />
                          ) : (
                            <div className="truncate text-sm font-medium">{app.name}</div>
                          )}
                          <div className="truncate text-xs text-[var(--color-ink-faint)]">
                            {app.botUser.username}#{app.botUser.discriminator}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setInviteApp(app)}
                            title={t('developers.inviteLink')}
                            className="rounded p-1.5 text-[var(--color-brand)] hover:bg-[var(--color-surface-3)]"
                          >
                            <Link2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(app.id);
                              setRenameValue(app.name);
                            }}
                            title={t('developers.rename')}
                            className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)]"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void resetToken(app)}
                            disabled={busyId === app.id}
                            title={t('developers.resetToken')}
                            className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] disabled:opacity-40"
                          >
                            <KeyRound size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteApp(app)}
                            disabled={busyId === app.id}
                            title={t('developers.delete')}
                            className="rounded p-1.5 text-[var(--color-danger)] hover:bg-[var(--color-surface-3)] disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {revealedToken?.appId === app.id && (
                        <TokenReveal token={revealedToken.token} onDismiss={() => setRevealedToken(null)} />
                      )}
                    </div>
                  ))}

                  {apps.length === 0 && !creating && (
                    <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('developers.empty')}</p>
                  )}
                </div>
              )}

              <div className="mt-3 border-t border-[var(--color-line)] px-1 pt-3">
                {creating ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newName}
                      placeholder={t('developers.namePlaceholder')}
                      maxLength={Limits.BOT_NAME_MAX}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void createApp()}
                      className="flex-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-brand)]"
                    />
                    <button
                      type="button"
                      onClick={() => void createApp()}
                      className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-black"
                    >
                      {t('common.create')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewName('');
                        setError(null);
                      }}
                      className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)]"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex items-center gap-1.5 rounded bg-[var(--color-surface-3)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
                  >
                    <Plus size={15} /> {t('developers.newApplication')}
                  </button>
                )}
                {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Token yalnızca burada, bir kez görünür — bilinçli olarak sayfa yeniden yüklenince kaybolur. */
function TokenReveal({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mt-2 rounded border border-[var(--color-brand)]/40 bg-[var(--color-brand)]/10 p-2.5">
      <p className="mb-1.5 text-xs font-medium text-[var(--color-brand)]">{t('developers.tokenRevealWarning')}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs">{token}</code>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-1 text-xs hover:bg-[var(--color-surface-2)]"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('developers.copied') : t('developers.copy')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)]"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/** İzin seçimine göre `/bot-ekle/:id?permissions=...` davet linki üretir — bkz. BotInviteScreen. */
function InviteLinkBuilder({ app, onBack }: { app: APIBotApplication; onBack: () => void }) {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<bigint>(0n);
  const [copied, setCopied] = useState(false);

  const link = `${location.origin}/bot-ekle/${app.id}?permissions=${permissions.toString()}`;

  function toggle(bit: bigint, value: boolean) {
    setPermissions((prev) => (value ? prev | bit : prev & ~bit));
  }

  function copy() {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        ← {t('developers.backToApps')}
      </button>

      <div className="mb-3 flex items-center gap-3 px-1">
        <Avatar name={app.name} avatarUrl={app.botUser.avatarUrl} size={40} initials={initialsFromName(app.name)} />
        <div className="min-w-0">
          <div className="truncate font-medium">{app.name}</div>
          <div className="text-xs text-[var(--color-ink-faint)]">{t('developers.inviteLinkHint')}</div>
        </div>
      </div>

      {PERMISSION_GROUPS.map((group) => (
        <section key={group.id} className="mb-4 px-1">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            {t(`roles.groups.${group.id}`)}
          </h3>
          <div className="space-y-0.5">
            {group.permissions.map((name) => {
              const bit = Permission[name];
              const checked = has(permissions, bit);
              return (
                <label
                  key={name}
                  className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-surface-2)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggle(bit, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">{t(`roles.permissions.${name}.name`)}</span>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 mt-2 border-t border-[var(--color-line)] bg-[var(--color-surface-1)] px-1 pt-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-[var(--color-surface-3)] px-2 py-1.5 text-xs">{link}</code>
          <button
            type="button"
            onClick={copy}
            className="flex shrink-0 items-center gap-1 rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-black"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('developers.copied') : t('developers.copy')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPermissions(permissions === ALL_PERMISSIONS ? 0n : ALL_PERMISSIONS)}
          className="mt-2 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {permissions === ALL_PERMISSIONS ? t('developers.clearAll') : t('developers.selectAll')}
        </button>
      </div>
    </div>
  );
}
