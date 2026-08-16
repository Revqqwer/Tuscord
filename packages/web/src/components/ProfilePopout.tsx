/**
 * Başka bir kullanıcının profil kartı — üyeye tıklayınca açılır.
 *
 * Discord'un "user popout"u gibi: avatar, ad, kullanıcı adı#dördül, hakkında,
 * bu sunucudaki rolleri, katılma tarihi ve "Mesaj gönder" düğmesi.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, Clock, UserPlus, X } from 'lucide-react';
import type { APIBlock, APIFriendship, APIGuildMember, APIRole, PublicUser } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { BlockConfirmModal } from './BlockConfirmModal';

interface Props {
  /** Her zaman var — mesaj yazarı da üye de PublicUser taşır. */
  user: PublicUser;
  /**
   * Bu sunucudaki üyelik kaydı; varsa takma ad, roller ve katılma tarihi
   * gösterilir. Mesajdaki isme tıklandığında üye listesi yüklü değilse
   * ya da kişi ayrılmışsa null olabilir — o zaman yalnızca temel profil.
   */
  member?: APIGuildMember | null;
  roles: APIRole[];
  /** Kendi profilin mi (o zaman "Mesaj gönder" gösterilmez). */
  isSelf: boolean;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  /** Bu sunucunun id'si — rol atama uçları bunu gerektiriyor. */
  guildId?: string;
  /** ASSIGN_ROLES iznim var mı — varsa roller salt okunur rozet yerine
   * işaretlenebilir liste olarak gösterilir (bkz. RoleSettings.tsx'teki
   * "Bu roldeki üyeler" ile AYNI uç, burada tek üye için tersine çevrilmiş). */
  canAssignRoles?: boolean;
  /** Kendi en yüksek rol konumum (sahipsem Infinity) — hiyerarşi kilidi. */
  ownHighestPosition?: number;
  onSendMessage: () => void;
  onClose: () => void;
}

export function ProfilePopout({
  user,
  member,
  roles,
  isSelf,
  status,
  guildId,
  canAssignRoles,
  ownHighestPosition,
  onSendMessage,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const displayed = member?.nickname ?? user.displayName ?? user.username;
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Bu kişiyle mevcut arkadaşlık durumu — buton buna göre değişir.
  const friendship = useStore((s) => s.friends.find((f) => f.user.id === user.id));
  const upsertFriend = useStore((s) => s.upsertFriend);
  const isBlocked = useStore((s) => s.blocks.some((b) => b.user.id === user.id));
  const addBlock = useStore((s) => s.addBlock);
  const removeBlock = useStore((s) => s.removeBlock);
  const removeFriend = useStore((s) => s.removeFriend);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  // Bu kart açıkken kanal sürükle-bırak sıralaması kilitlenir — bkz.
  // UserSettings.tsx'teki aynı efekt ve store'daki channelDragLockCount yorumu.
  useEffect(() => {
    const { lockChannelDrag, unlockChannelDrag } = useStore.getState();
    lockChannelDrag();
    return unlockChannelDrag;
  }, []);

  async function addFriend() {
    setBusy(true);
    setError(null);
    try {
      const friend = await api.post<APIFriendship>('/users/@me/friends', {
        tag: `${user.username}#${user.discriminator}`,
      });
      upsertFriend(friend);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      const key = `friends.errors.${code}`;
      const translated = t(key);
      setError(translated === key ? t('common.error') : translated);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    if (isBlocked) {
      setBusy(true);
      await api.delete(`/users/@me/blocks/${user.id}`).catch(() => undefined);
      removeBlock(user.id);
      setBusy(false);
      return;
    }
    setConfirmingBlock(true); // onay bizim modalımızda — bkz. render
  }

  async function confirmBlock() {
    setConfirmingBlock(false);
    setBusy(true);
    try {
      const block = await api.put<APIBlock>(`/users/@me/blocks/${user.id}`);
      addBlock(block);
      // Engellemek sunucu tarafında arkadaşlığı da siliyor — yerelde de düş.
      removeFriend(user.id);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  // @everyone hariç, üyenin taşıdığı roller; hiyerarşi sırasıyla.
  const memberRoles = member
    ? roles
        .filter((role) => member.roles.includes(role.id) && role.id !== role.guildId)
        .sort((a, b) => b.position - a.position)
    : [];

  // Hedefin en yüksek rol konumu — bu, kendimden üstse (sahip değilsem)
  // hiçbir rolünü değiştiremem (bkz. canManageMember, server tarafında aynı kural).
  const targetHighestPosition = memberRoles[0]?.position ?? 0;
  const canEditThisMember =
    Boolean(member) &&
    !isSelf &&
    Boolean(guildId) &&
    Boolean(canAssignRoles) &&
    (ownHighestPosition ?? 0) > targetHighestPosition;

  const assignableRoles = roles.filter((role) => role.id !== guildId).sort((a, b) => b.position - a.position);

  async function toggleRole(roleId: string, has: boolean) {
    if (!guildId || !member) return;
    setRoleBusyId(roleId);
    setRoleError(null);
    try {
      if (has) {
        await api.delete(`/guilds/${guildId}/members/${member.user.id}/roles/${roleId}`);
      } else {
        await api.put(`/guilds/${guildId}/members/${member.user.id}/roles/${roleId}`);
      }
      // Sunucu GUILD_MEMBER_UPDATE olayını yayınlıyor; store.members buradan
      // güncelleniyor ve bu bileşenin `member` prop'u yeniden render'da
      // otomatik tazeleniyor — elle yeniden çekmeye gerek yok.
    } catch {
      setRoleError(t('common.error'));
    } finally {
      setRoleBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={displayed}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xs overflow-hidden rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        {/* Üst bant — marka rengi */}
        <div className="h-16 bg-[var(--color-brand-strong)]" />

        <div className="px-4 pb-4">
          <div className="-mt-9 mb-2 flex items-end justify-between">
            <span className="rounded-full ring-4 ring-[var(--color-surface-1)]">
              <Avatar name={displayed} avatarUrl={user.avatarUrl} size={72} status={status} />
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <X size={18} />
            </button>
          </div>

          <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
            <div className="text-lg font-semibold leading-tight">{displayed}</div>
            <div className="text-sm text-[var(--color-ink-faint)]">
              {user.username}#{user.discriminator}
            </div>

            {user.bio ? (
              <p className="mt-3 whitespace-pre-wrap break-words border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-ink-muted)]">
                {user.bio}
              </p>
            ) : (
              <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-ink-faint)]">
                {t('profile.bioEmpty')}
              </p>
            )}

            {canEditThisMember ? (
              <div className="mt-3 border-t border-[var(--color-line)] pt-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  {t('profile.roles')}
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {assignableRoles.map((role) => {
                    const has = member?.roles.includes(role.id) ?? false;
                    const locked = role.position >= (ownHighestPosition ?? 0);
                    return (
                      <label
                        key={role.id}
                        className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                          locked ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--color-surface-3)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={locked || roleBusyId !== null}
                          onChange={() => void toggleRole(role.id, has)}
                          className="accent-[var(--color-brand)]"
                        />
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: role.color
                              ? `#${role.color.toString(16).padStart(6, '0')}`
                              : 'var(--color-ink-faint)',
                          }}
                        />
                        <span className="truncate">{role.name}</span>
                      </label>
                    );
                  })}
                </div>
                {roleError && <p className="mt-1 text-xs text-[var(--color-danger)]">{roleError}</p>}
              </div>
            ) : (
              memberRoles.length > 0 && (
                <div className="mt-3 border-t border-[var(--color-line)] pt-3">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {t('profile.roles')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {memberRoles.map((role) => (
                      <span
                        key={role.id}
                        className="flex items-center gap-1 rounded bg-[var(--color-surface-3)] px-2 py-0.5 text-xs"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            background: role.color
                              ? `#${role.color.toString(16).padStart(6, '0')}`
                              : 'var(--color-ink-faint)',
                          }}
                        />
                        {role.name}
                      </span>
                    ))}
                  </div>
                </div>
              )
            )}

            {member && (
              <div className="mt-3 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-faint)]">
                {t('profile.memberSince')}:{' '}
                {new Date(member.joinedAt).toLocaleDateString('tr', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            )}
          </div>

          {!isSelf && (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={onSendMessage}
                className="w-full rounded bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
              >
                {t('profile.sendMessage')}
              </button>

              {/* Arkadaşlık durumu: yoksa "ekle", bekliyorsa/arkadaşsa bilgi. */}
              {friendship?.status === 'accepted' ? (
                <div className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-online)]">
                  <Check size={15} /> {t('profile.alreadyFriends')}
                </div>
              ) : friendship?.status === 'pending' ? (
                <div className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-ink-muted)]">
                  <Clock size={15} />{' '}
                  {friendship.direction === 'incoming'
                    ? t('profile.friendRequestReceived')
                    : t('profile.friendRequestSent')}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void addFriend()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand)] transition hover:bg-[var(--color-brand)]/10 disabled:opacity-50"
                >
                  <UserPlus size={15} /> {t('profile.addFriend')}
                </button>
              )}

              <button
                type="button"
                onClick={() => void toggleBlock()}
                disabled={busy}
                className={`flex w-full items-center justify-center gap-1.5 rounded border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  isBlocked
                    ? 'border-[var(--color-line)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                    : 'border-transparent text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
                }`}
              >
                <Ban size={15} /> {isBlocked ? t('profile.unblock') : t('profile.block')}
              </button>

              {error && <p className="text-center text-xs text-[var(--color-danger)]">{error}</p>}
            </div>
          )}
        </div>
      </div>

      {confirmingBlock && (
        <BlockConfirmModal
          name={displayed}
          onConfirm={() => void confirmBlock()}
          onCancel={() => setConfirmingBlock(false)}
        />
      )}
    </div>
  );
}
