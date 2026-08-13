/**
 * Ana dÃ¼zen: sunucu ÅŸeridi â†’ kanal listesi â†’ mesaj alanÄ± â†’ Ã¼ye listesi.
 * (Spec BÃ¶lÃ¼m 9: dÃ¼zen ve etkileÅŸim kalÄ±plarÄ± serbestÃ§e kopyalanabilir.)
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AtSign,
  Hash,
  Lock,
  Menu,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  ChannelType,
  Permission,
  type APIGuildMember,
  type APIMessage,
  type PresenceStatus,
  type PublicUser,
} from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore, type GuildState } from '../store';
import { can, channelPermissions } from '../lib/permissions';
import { useIsMobile } from '../hooks/useIsMobile';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ModerationPanel } from './ModerationPanel';
import { RoleSettings } from './RoleSettings';
import { UserSettings } from './UserSettings';
import { ProfilePopout } from './ProfilePopout';
import { FriendsPanel } from './FriendsPanel';
import { Avatar } from './Avatar';
import { GuildModal } from './GuildModal';
import { ServerSettings } from './ServerSettings';
import { ChannelSettings } from './ChannelSettings';
import { SearchModal } from './SearchModal';
import { AdminPanel } from './AdminPanel';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { VoiceChannelItem, VoiceControlBar } from './VoiceChannel';
import { VoiceStage } from './VoiceStage';
import { ChannelCreateModal } from './ChannelCreateModal';
import type { APIChannel, APIFriendship } from '@tuscord/shared';

export function ChatShell() {
  const { t } = useTranslation();
  const store = useStore();
  const { guilds, activeGuildId, activeChannelId, user, status } = store;

  const guildState = activeGuildId ? guilds.get(activeGuildId) : undefined;
  const dmChannel = store.dmView
    ? store.privateChannels.find((c) => c.id === activeChannelId)
    : undefined;
  const channel = dmChannel ?? guildState?.channels.find((c) => c.id === activeChannelId);
  const messages = activeChannelId ? (store.messages.get(activeChannelId) ?? []) : [];

  /**
   * DM'de rol ve overwrite yoktur; katılımcıysan sabit izin kümesine sahipsin.
   * Sunucu da aynı kuralı uyguluyor (services/channelAccess.ts).
   */
  const permissions = useMemo(() => {
    if (dmChannel) {
      return (
        Permission.VIEW_CHANNEL |
        Permission.READ_MESSAGE_HISTORY |
        Permission.SEND_MESSAGES |
        Permission.ATTACH_FILES |
        Permission.ADD_REACTIONS |
        Permission.EMBED_LINKS
      );
    }
    return guildState && channel ? channelPermissions(guildState, channel) : 0n;
  }, [guildState, channel, dmChannel]);

  const canSend =
    can(permissions, Permission.SEND_MESSAGES) &&
    (!channel?.locked || can(permissions, Permission.MANAGE_CHANNELS));
  // DM'de kimse karşı tarafın mesajını silemez.
  const canManageMessages = !dmChannel && can(permissions, Permission.MANAGE_MESSAGES);

  /** DM başlığı: karşı tarafın adı (grup DM'de virgülle). */
  const dmTitle = dmChannel
    ? (dmChannel.recipients ?? [])
        .map((user) => user.displayName ?? user.username)
        .join(', ') || t('dm.unknown')
    : null;

  const [replyTo, setReplyTo] = useState<APIMessage | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  /**
   * Aramadan / yanıttan gelen "mesaja git" hedefi. Kanal farklıysa önce o
   * kanala geçilir; MessageList yüklendiğinde mesajı ortalayıp vurgular.
   */
  const [jumpTarget, setJumpTarget] = useState<{ channelId: string; messageId: string } | null>(
    null,
  );
  /**
   * Açık profil kartının kullanıcısı. Hem üye listesinden hem mesaj yazarından
   * açılabildiği için PublicUser tutuyoruz; üye bilgisi (rol/katılma) varsa
   * render sırasında mağazadan tamamlanır.
   */
  const [profileUser, setProfileUser] = useState<PublicUser | null>(null);

  // Bana gelen bekleyen arkadaşlık istekleri (alt çubuktaki rozet).
  const pendingRequests = store.friends.filter(
    (f) => f.status === 'pending' && f.direction === 'incoming',
  ).length;
  // Geçiş yalnızca ilk etkileşimden sonra açılır; mount animasyonunu bastırır.
  const [animateSidebar, setAnimateSidebar] = useState(false);
  const isMobile = useIsMobile();

  function toggleSidebar(open: boolean) {
    // Bir frame bekle: transform commit edildikten SONRA transition açılsın,
    // yoksa açılış animasyonu takılır.
    if (!animateSidebar) requestAnimationFrame(() => setAnimateSidebar(true));
    setSidebarOpen(open);
  }

  // Bahsetmeleri isimle göstermek için arama tabloları.
  const members = activeGuildId ? (store.members.get(activeGuildId) ?? []) : [];
  const userNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.user.id, member.nickname ?? member.user.displayName ?? member.user.username);
    }
    // Listeye girmemiş yazarlar (ayrılmış üyeler) mesajlardan tamamlanır.
    for (const message of messages) {
      if (!map.has(message.author.id)) {
        map.set(message.author.id, message.author.displayName ?? message.author.username);
      }
    }
    return map;
  }, [members, messages]);

  const roleNames = useMemo(
    () => new Map((guildState?.roles ?? []).map((role) => [role.id, role.name])),
    [guildState],
  );

  // @ ile etiketlenebilecek kişiler — sunucu kanalında üyeler, DM'de yok.
  const mentionables = useMemo(
    () =>
      dmChannel
        ? []
        : members.map((m) => ({
            id: m.user.id,
            username: m.user.username,
            displayName: m.nickname ?? m.user.displayName,
            avatarUrl: m.user.avatarUrl,
          })),
    [members, dmChannel],
  );

  // Kanal değişince yanıt hedefi düşer — başka kanalda yanıtlamak anlamsız.
  useEffect(() => setReplyTo(null), [activeChannelId]);

  // Açılışta arkadaşları ve bekleyen istekleri yükle.
  useEffect(() => {
    void api
      .get<APIFriendship[]>('/users/@me/friends')
      .then((list) => store.setFriends(list))
      .catch(() => undefined);

    // Bahsetme bildirimleri için izin iste (bir kez). Reddedilirse uygulama
    // içi rozet yine çalışır, sorun olmaz.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const ask = () => {
        void Notification.requestPermission();
        window.removeEventListener('click', ask);
      };
      // Tarayıcı izni bir kullanıcı jestinde ister; ilk tıklamada sor.
      window.addEventListener('click', ask, { once: true });
    }
  }, []);

  /**
   * Açık kanalı okundu işaretle.
   *
   * Kanal açıkken gelen her yeni mesaj da okundu sayılır: kullanıcı zaten
   * ekrana bakıyor, rozet göstermek gürültü olur. Sekme arkaplandaysa
   * işaretleme yapılmaz — okunmamış sayacının anlamı budur.
   */
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!activeChannelId || !lastMessageId) return;

    const acknowledge = () => {
      if (document.visibilityState !== 'visible') return;
      const known = useStore.getState().readStates.get(activeChannelId);
      if (known?.lastReadMessageId === lastMessageId && known.mentionCount === 0) return;

      useStore.getState().markRead(activeChannelId, lastMessageId);
      void api
        .post(`/channels/${activeChannelId}/ack`, { messageId: lastMessageId })
        .catch(() => undefined);
    };

    acknowledge();

    // Sekme arka plandayken gelen mesajlar okunmamış kalır; kullanıcı geri
    // döndüğünde işaretlenir. Bu dinleyici olmadan rozet ekranda takılı kalırdı.
    document.addEventListener('visibilitychange', acknowledge);
    return () => document.removeEventListener('visibilitychange', acknowledge);
  }, [activeChannelId, lastMessageId]);

  // Kanal deÄŸiÅŸince geÃ§miÅŸi yÃ¼kle.
  useEffect(() => {
    if (!activeChannelId) return;
    let cancelled = false;
    void api
      .get<APIMessage[]>(`/channels/${activeChannelId}/messages?limit=50`)
      .then((list) => {
        // Sunucu yeniden eskiye dÃ¶ner; liste eskiden yeniye gÃ¶sterilir.
        if (!cancelled) store.setMessages(activeChannelId, [...list].reverse());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  // Ãœye listesi + anlık çevrimiçi durumları.
  useEffect(() => {
    if (!activeGuildId) return;
    void api
      .get<APIGuildMember[]>(`/guilds/${activeGuildId}/members?limit=200`)
      .then((list) => store.setMembers(activeGuildId, list))
      .catch(() => undefined);

    // Presence snapshot: gateway yalnızca değişimde olay yollar; ilk açılışta
    // zaten çevrimiçi olanları (kendimiz dahil) buradan tohumluyoruz.
    void api
      .get<{ userId: string; status: PresenceStatus }[]>(`/guilds/${activeGuildId}/presences`)
      .then((list) => list.forEach((p) => store.setPresence(p.userId, p.status)))
      .catch(() => undefined);
  }, [activeGuildId]);

  async function loadOlder() {
    if (!activeChannelId || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    const older = await api.get<APIMessage[]>(
      `/channels/${activeChannelId}/messages?limit=50&before=${oldest.id}`,
    );
    if (older.length > 0) store.prependMessages(activeChannelId, [...older].reverse());
  }

  return (
    <div className="flex h-full">
      {/*
        Dar ekranda sunucu şeridi ve kanal listesi kayar panel olur.
        Masaüstünde (md ve üstü) her zaman görünür ve akışın parçasıdır.
      */}
      <div
        data-sidebar={sidebarOpen ? 'open' : 'closed'}
        // Konum mobilde açıkça veriliyor; masaüstünde stil yok, panel akışta durur.
        //
        // `transform: translateX` (translate kısayolu değil — o bu projede
        // computed değere yansımıyordu). Geçiş yalnızca `animateSidebar` true
        // iken uygulanır: mount anında transition açık olursa panel ekran
        // dışında olduğu için başlangıç değeri commit edilmiyor ve animasyon
        // `-100%`'de takılıyordu. rAF ile bir frame sonra açıyoruz.
        style={
          isMobile
            ? {
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: animateSidebar ? 'transform 200ms ease-out' : 'none',
              }
            : undefined
        }
        className="fixed inset-y-0 left-0 z-40 flex md:static md:z-auto"
      >
        <ServerRail onNavigate={() => toggleSidebar(false)} />
        <div className="flex w-60 shrink-0 flex-col bg-[var(--color-surface-1)]">
          <div className="flex min-h-0 flex-1 flex-col">
            {store.dmView ? (
              <DMList onNavigate={() => toggleSidebar(false)} />
            ) : (
              <ChannelList onNavigate={() => toggleSidebar(false)} />
            )}
          </div>
          {/* Ses bağlıysa kontrol çubuğu — kullanıcı çubuğunun hemen üstünde. */}
          <VoiceControlBar />
          {/* Alt kullanıcı çubuğu — kendi avatarın + ad + ayarlar (Discord kalıbı). */}
          {user && (
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5">
              <Avatar name={user.displayName ?? user.username} avatarUrl={user.avatarUrl} size={32} status="online" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-medium">{user.displayName ?? user.username}</div>
                <div className="truncate text-xs text-[var(--color-ink-faint)]">
                  {user.username}#{user.discriminator}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFriendsOpen(true)}
                aria-label={t('friends.open')}
                title={t('friends.open')}
                className="relative rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
              >
                <UserPlus size={17} />
                {pendingRequests > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-dnd)] px-1 text-[10px] font-semibold text-white">
                    {pendingRequests}
                  </span>
                )}
              </button>
              {user.isAdmin && (
                <button
                  type="button"
                  onClick={() => setAdminOpen(true)}
                  aria-label={t('admin.title')}
                  title={t('admin.title')}
                  className="rounded p-1.5 text-[var(--color-brand)] hover:bg-[var(--color-surface-3)]"
                >
                  <ShieldCheck size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t('profile.settings')}
                title={t('profile.settings')}
                className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
              >
                <Settings size={17} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Panel açıkken arka planı karart; dokununca kapansın. */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => toggleSidebar(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-surface-0)]">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-4">
          <button
            type="button"
            onClick={() => toggleSidebar(true)}
            aria-label={t('common.menu')}
            className="-ml-1 p-1.5 text-[var(--color-ink-muted)] md:hidden"
          >
            <Menu size={20} />
          </button>
          {channel ? (
            <>
              {dmChannel ? (
                <AtSign size={18} className="text-[var(--color-ink-faint)]" />
              ) : (
                <Hash size={18} className="text-[var(--color-ink-faint)]" />
              )}
              <span className="font-medium">{dmTitle ?? channel.name}</span>
              {channel.topic && (
                <span className="ml-2 truncate text-sm text-[var(--color-ink-muted)]">
                  {channel.topic}
                </span>
              )}
            </>
          ) : (
            <span className="text-[var(--color-ink-muted)]">{t('channel.empty')}</span>
          )}
          {status !== 'ready' && (
            <span className="text-xs text-[var(--color-idle)]">
              {status === 'reconnecting' ? t('app.reconnecting') : t('app.connecting')}
            </span>
          )}
          {/* Mesaj arama — yalnızca sunucu kanalında (DM'de arama yok). */}
          {guildState && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={t('search.title')}
              title={t('search.title')}
              className="ml-auto rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              <Search size={18} />
            </button>
          )}
        </header>

        {/* Ekran paylaşımı sahnesi — ses kanalındayken aktif paylaşımlar. */}
        <VoiceStage />

        {channel ? (
          <>
            <MessageList
              messages={messages}
              currentUserId={user?.id ?? null}
              canManageMessages={canManageMessages}
              userNames={userNames}
              roleNames={roleNames}
              onLoadOlder={() => void loadOlder()}
              onDelete={(message) => {
                if (!confirm(t('message.deleteConfirm'))) return;
                void api.delete(`/channels/${message.channelId}/messages/${message.id}`);
              }}
              onEdit={async (message, content) => {
                await api.patch(`/channels/${message.channelId}/messages/${message.id}`, {
                  content,
                });
              }}
              onReply={setReplyTo}
              onOpenProfile={setProfileUser}
              onToggleReaction={(message, emoji, active) => {
                const path = `/channels/${message.channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
                void (active ? api.delete(path) : api.put(path)).catch(() => undefined);
              }}
              onReport={(message) => {
                const reason = prompt(t('message.reportPrompt'));
                if (!reason) return;
                void api
                  .post('/reports', {
                    targetType: 'message',
                    targetId: message.id,
                    reason,
                  })
                  .then(() => alert(t('message.reportSent')))
                  .catch(() => undefined);
              }}
              pendingJumpId={
                jumpTarget?.channelId === activeChannelId ? jumpTarget.messageId : null
              }
              onJumpHandled={() => setJumpTarget(null)}
            />
            <Composer
              channelId={channel.id}
              channelName={channel.name ?? ''}
              disabled={!canSend}
              canAttach={can(permissions, Permission.ATTACH_FILES)}
              slowmodeSeconds={channel.slowmodeSeconds}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              mentionables={mentionables}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[var(--color-ink-faint)]">
            {t('channel.empty')}
          </div>
        )}
      </div>

      <MemberList onOpenProfile={(member) => setProfileUser(member.user)} />

      {settingsOpen && user && (
        <UserSettings user={user} onClose={() => setSettingsOpen(false)} />
      )}

      {friendsOpen && user && (
        <FriendsPanel
          self={user}
          onClose={() => setFriendsOpen(false)}
          onMessage={(target) => {
            setFriendsOpen(false);
            void startDM(target);
          }}
        />
      )}

      {searchOpen && guildState && (
        <SearchModal
          guildId={guildState.guild.id}
          onClose={() => setSearchOpen(false)}
          onJump={(channelId, messageId) => {
            setSearchOpen(false);
            // Farklı kanaldaysa önce oraya geç; MessageList yüklenince atlar.
            if (channelId !== activeChannelId) store.setActive(guildState.guild.id, channelId);
            setJumpTarget({ channelId, messageId });
          }}
        />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {profileUser && (
        <ProfilePopout
          user={profileUser}
          member={
            guildState?.member.user.id === profileUser.id
              ? guildState.member
              : (members.find((m) => m.user.id === profileUser.id) ?? null)
          }
          roles={guildState?.roles ?? []}
          isSelf={profileUser.id === user?.id}
          status={store.presence.get(profileUser.id) ?? 'offline'}
          onClose={() => setProfileUser(null)}
          onSendMessage={() => {
            const target = profileUser.id;
            setProfileUser(null);
            void startDM(target);
          }}
        />
      )}
    </div>
  );

  async function startDM(targetUserId: string) {
    if (targetUserId === user?.id) return;
    const channel = await api
      .post<{ id: string }>('/users/@me/channels', { recipientIds: [targetUserId] })
      .catch(() => null);
    if (!channel) return;
    store.upsertPrivateChannel(channel as never);
    store.openDMView(channel.id);
  }
}

interface NavProps {
  /** Mobilde bir seçim yapıldığında kayar paneli kapatmak için. */
  onNavigate: () => void;
}

function ServerRail({ onNavigate }: NavProps) {
  const { t } = useTranslation();
  const { guilds, activeGuildId, setActive, openDMView, dmView } = useStore();
  const removeGuild = useStore((s) => s.removeGuild);
  const [modalOpen, setModalOpen] = useState(false);
  // Ayarları açık olan sunucu (sağ tık → Ayarlar).
  const [settingsGuild, setSettingsGuild] = useState<GuildState | null>(null);
  const menu = useContextMenu();

  async function leaveGuild(guildId: string) {
    if (!confirm(t('guild.leaveConfirm'))) return;
    await api.delete(`/guilds/${guildId}/members/@me`).catch(() => undefined);
    removeGuild(guildId);
  }

  function guildMenu(state: GuildState): MenuItem[] {
    const canManage = can(BigInt(state.permissions), Permission.MANAGE_GUILD);
    const isOwner = state.guild.ownerId === useStore.getState().user?.id;
    const items: MenuItem[] = [];
    if (canManage) {
      items.push({
        label: t('serverSettings.title'),
        icon: <Settings size={15} />,
        onClick: () => setSettingsGuild(state),
      });
    }
    if (!isOwner) {
      items.push({
        label: t('guild.leave'),
        danger: true,
        onClick: () => void leaveGuild(state.guild.id),
      });
    }
    return items.length > 0 ? items : [{ label: t('guild.noActions'), disabled: true, onClick: () => {} }];
  }

  return (
    <nav
      aria-label={t('guild.settings')}
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-[var(--color-surface-2)] py-3"
    >
      {/* DM görünümü şeridin en üstünde — Discord'daki gibi. */}
      <button
        type="button"
        title={t('dm.title')}
        aria-label={t('dm.title')}
        onClick={() => openDMView()}
        className={`flex h-12 w-12 items-center justify-center transition-all ${
          dmView
            ? 'rounded-2xl bg-[var(--color-brand)] text-black'
            : 'rounded-3xl bg-[var(--color-surface-3)] hover:rounded-2xl hover:bg-[var(--color-brand)] hover:text-black'
        }`}
      >
        <AtSign size={20} />
      </button>
      <div className="my-1 h-px w-8 bg-[var(--color-line)]" />

      {[...guilds.values()].map((state) => {
        const active = state.guild.id === activeGuildId && !dmView;
        return (
          <button
            key={state.guild.id}
            type="button"
            title={state.guild.name}
            onContextMenu={(e) => menu.open(e, guildMenu(state))}
            onClick={() => {
              const firstText = state.channels.find((c) => c.type === ChannelType.GUILD_TEXT);
              setActive(state.guild.id, firstText?.id ?? null);
              // Sunucu değiştirmek kanal listesini açık bırakır: kullanıcı
              // büyük ihtimalle sıradaki adımda kanal seçecek.
            }}
            className={`flex h-12 w-12 items-center justify-center overflow-hidden text-sm font-semibold transition-all ${
              active
                ? 'rounded-2xl bg-[var(--color-brand)] text-black'
                : 'rounded-3xl bg-[var(--color-surface-3)] hover:rounded-2xl hover:bg-[var(--color-brand)] hover:text-black'
            }`}
          >
            {state.guild.iconUrl ? (
              <img src={state.guild.iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              state.guild.name.slice(0, 2).toLocaleUpperCase('tr')
            )}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={t('guild.create')}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-[var(--color-surface-3)] text-[var(--color-online)] transition-all hover:rounded-2xl"
      >
        <Plus size={20} />
      </button>

      {modalOpen && (
        <GuildModal
          onClose={() => setModalOpen(false)}
          onDone={(guildId) => {
            setModalOpen(false);
            // Kanallar GUILD_CREATE ile gelir; olay ulaşınca store açar.
            useStore.getState().setPendingActiveGuild(guildId);
            onNavigate();
          }}
        />
      )}

      {settingsGuild && (
        <ServerSettings guildState={settingsGuild} onClose={() => setSettingsGuild(null)} />
      )}

      {menu.node}
    </nav>
  );
}

/** DM ve grup DM listesi. Sunucu kanal listesinin yerine geçer. */
function DMList({ onNavigate }: NavProps) {
  const { t } = useTranslation();
  const { privateChannels, activeChannelId, openDMView, user, readStates } = useStore();

  if (privateChannels.length === 0) {
    return (
      <>
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-line)] px-4">
          <span className="font-medium">{t('dm.title')}</span>
        </header>
        <p className="p-4 text-sm text-[var(--color-ink-muted)]">{t('dm.empty')}</p>
      </>
    );
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-line)] px-4">
        <span className="font-medium">{t('dm.title')}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {privateChannels.map((channel) => {
          const others = (channel.recipients ?? []).filter((r) => r.id !== user?.id);
          const label =
            others.map((r) => r.displayName ?? r.username).join(', ') || t('dm.unknown');
          const mentionCount = readStates.get(channel.id)?.mentionCount ?? 0;

          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => {
                openDMView(channel.id);
                onNavigate();
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${
                channel.id === activeChannelId
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-xs">
                {label.slice(0, 2).toLocaleUpperCase('tr')}
              </span>
              <span className="truncate">{label}</span>
              {mentionCount > 0 && (
                <span className="ml-auto rounded-full bg-[var(--color-dnd)] px-1.5 text-xs font-semibold text-white">
                  {mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function ChannelList({ onNavigate }: NavProps) {
  const { t } = useTranslation();
  const { guilds, activeGuildId, activeChannelId, setActive, readStates } = useStore();
  const [moderationOpen, setModerationOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<APIChannel | null>(null);
  const menu = useContextMenu();
  const state = activeGuildId ? guilds.get(activeGuildId) : undefined;

  /** Kanala sağ tık menüsü — yönetim izni olana ayarlar/sil. */
  function channelMenu(channel: APIChannel): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: t('channelSettings.open'),
        icon: <Settings size={15} />,
        onClick: () => setSettingsChannel(channel),
      },
    ];
    return items;
  }

  if (!state) {
    return <div className="p-4 text-sm text-[var(--color-ink-muted)]">{t('guild.empty')}</div>;
  }

  /**
   * Okunmamış: kanalın son mesajı, kullanıcının en son okuduğundan yeni.
   * Snowflake'ler zamana göre sıralı olduğu için karşılaştırma yeterli —
   * ayrıca sorgu atmaya gerek yok.
   */
  function isUnread(channel: { id: string; lastMessageId: string | null }): boolean {
    if (!channel.lastMessageId) return false;
    const readState = readStates.get(channel.id);
    if (!readState?.lastReadMessageId) return true;
    return BigInt(channel.lastMessageId) > BigInt(readState.lastReadMessageId);
  }

  const categories = state.channels
    .filter((c) => c.type === ChannelType.GUILD_CATEGORY)
    .sort((a, b) => a.position - b.position);
  const uncategorized = state.channels.filter(
    (c) => c.type !== ChannelType.GUILD_CATEGORY && !c.parentId,
  );

  const guildPerms = BigInt(state.permissions);
  const canManage = can(guildPerms, Permission.MANAGE_CHANNELS);
  const canManageRoles = can(guildPerms, Permission.MANAGE_ROLES);
  const canInvite = can(guildPerms, Permission.CREATE_INVITE);
  // Moderasyon düğmesi: bu izinlerden herhangi biri yeterli.
  const canModerate =
    can(guildPerms, Permission.KICK_MEMBERS) ||
    can(guildPerms, Permission.BAN_MEMBERS) ||
    can(guildPerms, Permission.MODERATE_MEMBERS) ||
    can(guildPerms, Permission.VIEW_AUDIT_LOG) ||
    can(guildPerms, Permission.MANAGE_GUILD);

  /** Kanalı tipine göre çiz: sesli kanal katıl/roster, metin kanalı buton. */
  function renderChannel(channel: APIChannel) {
    if (channel.type === ChannelType.GUILD_VOICE) {
      return (
        <div
          key={channel.id}
          onContextMenu={canManage ? (e) => menu.open(e, channelMenu(channel)) : undefined}
        >
          <VoiceChannelItem channel={channel} onNavigate={onNavigate} />
        </div>
      );
    }
    return (
      <ChannelButton
        key={channel.id}
        name={channel.name ?? ''}
        locked={channel.locked}
        active={channel.id === activeChannelId}
        unread={isUnread(channel)}
        mentionCount={readStates.get(channel.id)?.mentionCount ?? 0}
        onClick={() => {
          setActive(state!.guild.id, channel.id);
          onNavigate();
        }}
        onContextMenu={canManage ? (e) => menu.open(e, channelMenu(channel)) : undefined}
      />
    );
  }

  /**
   * Davet linki üretir ve panoya kopyalar.
   * Davet bir kanala bağlıdır (sunucu böyle istiyor); ilk metin kanalı
   * yeterli — kullanıcı için fark etmiyor.
   */
  async function createInvite() {
    const target =
      state?.channels.find((c) => c.id === activeChannelId && c.type === ChannelType.GUILD_TEXT) ??
      state?.channels.find((c) => c.type === ChannelType.GUILD_TEXT);
    if (!target) return;

    const invite = await api
      .post<{ code: string }>(`/channels/${target.id}/invites`, {})
      .catch(() => null);
    if (!invite) return;

    const url = `${location.origin}/davet/${invite.code}`;
    // clipboard API güvenli bağlam ister; başarısız olursa linki yine göster.
    try {
      await navigator.clipboard.writeText(url);
      alert(`${t('invite.copied')}\n\n${url}\n\n${t('invite.expires')}`);
    } catch {
      prompt(t('invite.copy'), url);
    }
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] px-4">
        <span className="truncate font-medium">{state.guild.name}</span>
        <div className="flex shrink-0 items-center gap-2">
          {canInvite && (
            <button
              type="button"
              onClick={() => void createInvite()}
              title={t('invite.create')}
              aria-label={t('invite.create')}
            >
              <UserPlus
                size={16}
                className="text-[var(--color-ink-muted)] hover:text-[var(--color-brand)]"
              />
            </button>
          )}
          {canManageRoles && (
            <button
              type="button"
              onClick={() => setRolesOpen(true)}
              title={t('roles.title')}
              aria-label={t('roles.title')}
            >
              <Shield
                size={16}
                className="text-[var(--color-ink-muted)] hover:text-[var(--color-brand)]"
              />
            </button>
          )}
          {canModerate && (
            <button
              type="button"
              onClick={() => setModerationOpen(true)}
              title={t('moderation.open')}
              aria-label={t('moderation.open')}
            >
              <ShieldAlert size={16} className="text-[var(--color-ink-muted)] hover:text-[var(--color-brand)]" />
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              title={t('channel.create')}
              aria-label={t('channel.create')}
            >
              <Plus size={16} className="text-[var(--color-ink-muted)]" />
            </button>
          )}
        </div>
      </header>

      {createOpen && activeGuildId && (
        <ChannelCreateModal guildId={activeGuildId} onClose={() => setCreateOpen(false)} />
      )}

      {moderationOpen && (
        <ModerationPanel guildState={state} onClose={() => setModerationOpen(false)} />
      )}

      {rolesOpen && <RoleSettings guildState={state} onClose={() => setRolesOpen(false)} />}

      <div className="flex-1 overflow-y-auto p-2">
        {uncategorized.map(renderChannel)}

        {categories.map((category) => (
          <div key={category.id} className="mt-3">
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {category.name}
            </div>
            {state.channels
              .filter((c) => c.parentId === category.id)
              .sort((a, b) => a.position - b.position)
              .map(renderChannel)}
          </div>
        ))}
      </div>

      {settingsChannel && (
        <ChannelSettings
          channel={settingsChannel}
          roles={state.roles}
          onClose={() => setSettingsChannel(null)}
        />
      )}

      {menu.node}
    </>
  );
}

function ChannelButton({
  name,
  active,
  locked,
  unread,
  mentionCount,
  onClick,
  onContextMenu,
}: {
  name: string;
  active: boolean;
  locked: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
        active
          ? 'bg-[var(--color-surface-3)] text-[var(--color-ink)]'
          : unread
            ? 'font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]'
            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
      }`}
    >
      {locked ? <Lock size={14} /> : <Hash size={14} />}
      <span className="truncate">{name}</span>

      {mentionCount > 0 ? (
        // Bahsetme sayısı okunmamış işaretinden ayrı gösterilir: "biri seni
        // çağırdı" ile "kanalda yeni mesaj var" farklı aciliyette.
        <span className="ml-auto rounded-full bg-[var(--color-dnd)] px-1.5 text-xs font-semibold text-white">
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      ) : unread && !active ? (
        <span className="ml-auto h-2 w-2 rounded-full bg-[var(--color-ink)]" />
      ) : null}
    </button>
  );
}

function MemberList({ onOpenProfile }: { onOpenProfile: (member: APIGuildMember) => void }) {
  const { t } = useTranslation();
  const { members, activeGuildId, presence } = useStore();
  const list = activeGuildId ? (members.get(activeGuildId) ?? []) : [];

  // Çevrimiçi/çevrimdışı iki ayrı grup (Discord kalıbı). Renkli nokta yerine
  // altlı üstlü başlıklarla ayrılıyor; çevrimdışı üyeler soluk gösterilir.
  const { online, offline } = useMemo(() => {
    const byName = (a: APIGuildMember, b: APIGuildMember) =>
      (a.nickname ?? a.user.displayName ?? a.user.username).localeCompare(
        b.nickname ?? b.user.displayName ?? b.user.username,
        'tr',
      );
    const online: APIGuildMember[] = [];
    const offline: APIGuildMember[] = [];
    for (const member of list) {
      if ((presence.get(member.user.id) ?? 'offline') === 'offline') offline.push(member);
      else online.push(member);
    }
    return { online: online.sort(byName), offline: offline.sort(byName) };
  }, [list, presence]);

  if (!activeGuildId) return null;

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-[var(--color-surface-1)] lg:flex">
      <header className="flex h-12 items-center gap-2 border-b border-[var(--color-line)] px-4 text-sm text-[var(--color-ink-muted)]">
        <Users size={16} />
        {t('guild.memberCount', { count: list.length })}
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        <MemberGroup
          label={t('memberGroups.online', { count: online.length })}
          members={online}
          presence={presence}
          onOpenProfile={onOpenProfile}
        />
        <MemberGroup
          label={t('memberGroups.offline', { count: offline.length })}
          members={offline}
          presence={presence}
          dim
          onOpenProfile={onOpenProfile}
        />
      </div>
    </aside>
  );
}

function MemberGroup({
  label,
  members,
  presence,
  dim,
  onOpenProfile,
}: {
  label: string;
  members: APIGuildMember[];
  presence: Map<string, 'online' | 'idle' | 'dnd' | 'offline'>;
  dim?: boolean;
  onOpenProfile: (member: APIGuildMember) => void;
}) {
  if (members.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {label}
      </div>
      {members.map((member) => (
        <button
          key={member.user.id}
          type="button"
          onClick={() => onOpenProfile(member)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-surface-2)] ${
            dim ? 'opacity-50' : ''
          }`}
        >
          <Avatar
            name={member.nickname ?? member.user.displayName ?? member.user.username}
            avatarUrl={member.user.avatarUrl}
            size={28}
            status={presence.get(member.user.id) ?? 'offline'}
          />
          <span className="truncate text-[var(--color-ink-muted)]">
            {member.nickname ?? member.user.displayName ?? member.user.username}
          </span>
        </button>
      ))}
    </div>
  );
}
