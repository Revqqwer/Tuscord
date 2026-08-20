/**
 * Bot yetkilendirme ekranı: `/bot-ekle/<applicationId>?permissions=<bitfield>`.
 *
 * Discord'daki OAuth2 bot davet akışının karşılığı: bot sahibi olmayan bir
 * sunucu yöneticisi bu linke tıklar, hangi botun hangi izinlerle eklenmek
 * istediğini görür, bir sunucu seçip onaylar. Onay = `POST /guilds/:id/bots`
 * — bot o sunucuya normal bir üye olarak eklenir + istenen izinleri taşıyan
 * kendi rolü oluşturulur (bkz. server routes/bots.ts).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSION_GROUPS, Permission, has, type APIBotApplication, type APIGuild } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { Avatar } from './Avatar';
import { initialsFromName } from '../lib/initials';

interface Props {
  applicationId: string;
  permissions: bigint;
  onCancel: () => void;
  onAdded: (guildId: string) => void;
}

export function BotInviteScreen({ applicationId, permissions, onCancel, onAdded }: Props) {
  const { t } = useTranslation();
  const [app, setApp] = useState<APIBotApplication | null | undefined>(undefined);
  const [guilds, setGuilds] = useState<APIGuild[] | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<APIBotApplication>(`/developers/applications/${applicationId}`)
      .then(setApp)
      .catch(() => setApp(null));
    void api
      .get<APIGuild[]>('/users/@me/guilds')
      .then((list) => {
        setGuilds(list);
        if (list.length > 0) setSelectedGuildId(list[0]!.id);
      })
      .catch(() => setGuilds([]));
  }, [applicationId]);

  async function confirm() {
    if (!selectedGuildId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/guilds/${selectedGuildId}/bots`, {
        applicationId,
        permissions: permissions.toString(),
      });
      onAdded(selectedGuildId);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      setError(
        code === 'bot_already_added'
          ? t('botInvite.alreadyAdded')
          : code === 'banned'
            ? t('botInvite.banned')
            : code === 'missing_permissions' || code === 'cannot_grant_permissions'
              ? t('botInvite.noPermission')
              : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  }

  const permissionNames = PERMISSION_GROUPS.flatMap((g) => g.permissions).filter((name) =>
    has(permissions, Permission[name]),
  );

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <div className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 text-center shadow-xl">
        {app === undefined ? (
          <p className="text-[var(--color-ink-muted)]">{t('common.loading')}</p>
        ) : app === null ? (
          <>
            <p className="text-[var(--color-danger)]">{t('botInvite.invalid')}</p>
            <button
              type="button"
              onClick={onCancel}
              className="mt-4 w-full rounded bg-[var(--color-surface-3)] px-4 py-2 text-sm"
            >
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            <Avatar
              name={app.name}
              avatarUrl={app.botUser.avatarUrl}
              size={64}
              initials={initialsFromName(app.name)}
            />
            <p className="mb-1 mt-3 text-sm text-[var(--color-ink-muted)]">{t('botInvite.wantsToJoin')}</p>
            <h1 className="mb-4 text-xl font-semibold">{app.name}</h1>

            {permissionNames.length > 0 && (
              <div className="mb-4 rounded bg-[var(--color-surface-2)] p-3 text-left">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  {t('botInvite.requestedPermissions')}
                </p>
                <ul className="space-y-0.5 text-sm text-[var(--color-ink-muted)]">
                  {permissionNames.map((name) => (
                    <li key={name}>{t(`roles.permissions.${name}.name`)}</li>
                  ))}
                </ul>
              </div>
            )}

            {guilds === null ? (
              <p className="text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>
            ) : guilds.length === 0 ? (
              <p className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                {t('botInvite.noGuilds')}
              </p>
            ) : (
              <select
                value={selectedGuildId}
                onChange={(e) => setSelectedGuildId(e.target.value)}
                className="mb-3 w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              >
                {guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}

            {error && (
              <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}

            {guilds && guilds.length > 0 && (
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy}
                className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('botInvite.confirm')}
              </button>
            )}

            <button
              type="button"
              onClick={onCancel}
              className="mt-3 w-full text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {t('common.cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
