/**
 * Ana dÃ¼zen: sunucu ÅŸeridi â†’ kanal listesi â†’ mesaj alanÄ± â†’ Ã¼ye listesi.
 * (Spec BÃ¶lÃ¼m 9: dÃ¼zen ve etkileÅŸim kalÄ±plarÄ± serbestÃ§e kopyalanabilir.)
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Bot,
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
  ALL_PERMISSIONS,
  ChannelType,
  Permission,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type PresenceStatus,
  type PublicUser,
} from '@tuscord/shared';
import { api } from '../lib/api';
import { useStore, type GuildState } from '../store';
import { can, channelPermissions } from '../lib/permissions';
import { initialsFromName } from '../lib/initials';
import { buildForcedChannel } from '../lib/forcedVoiceChannel';
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
import { DeveloperPortal } from './DeveloperPortal';
import { useContextMenu, type MenuItem } from './ContextMenu';
import {
  VOICE_USER_DRAG_TYPE,
  VoiceChannelItem,
  VoiceControlBar,
  type VoiceMenuState,
} from './VoiceChannel';
import { VoiceStage } from './VoiceStage';
import { VoiceChannelChatPanel } from './VoiceChannelChatPanel';
import { ChannelCreateModal } from './ChannelCreateModal';
import { InviteLinkModal } from './InviteLinkModal';
import type { APIBlock, APIChannel, APIFriendship } from '@tuscord/shared';

// Sabit referans: aşağıdaki `?? EMPTY_MEMBERS` her render'da yeni bir dizi
// oluşturmasın diye (bkz. VoiceChannelChatPanel.tsx'teki aynı yorum).
const EMPTY_MEMBERS: APIGuildMember[] = [];

export function ChatShell() {
  const { t } = useTranslation();
  const store = useStore();
  const { guilds, activeGuildId, activeChannelId, user, status } = store;

  const guildState = activeGuildId ? guilds.get(activeGuildId) : undefined;
  const dmChannel = store.dmView
    ? store.privateChannels.find((c) => c.id === activeChannelId)
    : undefined;
  // Zorla taşındığım (MOVE_MEMBERS) bir ses kanalı VIEW_CHANNEL'ım yoksa
  // guildState.channels'ta hiç yok — bulamazsak sentetik kayda düş, yoksa
  // VoiceStage hiç render olmaz (bkz. buildForcedChannel yorumu, kullanıcı
  // raporu: ekran paylaşımı/sohbet o kanaldaki herkese görünmeli).
  const channel =
    dmChannel ??
    guildState?.channels.find((c) => c.id === activeChannelId) ??
    (guildState && activeChannelId === store.voiceChannelId
      ? (buildForcedChannel(
          guildState.guild.id,
          guildState.channels,
          store.forcedVoiceChannelInfo,
          store.voiceChannelId,
        ) ?? undefined)
      : undefined);
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
  const [developerPortalOpen, setDeveloperPortalOpen] = useState(false);
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
  /**
   * Profil kartından rol atayabilmek için gereken izin/hiyerarşi bağlamı —
   * RoleSettings.tsx'teki ownPermissions/ownHighestPosition ile AYNI desen
   * (bkz. o dosyadaki yorum). DM'de guildState yok, o yüzden hepsi false/0.
   */
  const profileIsOwner = Boolean(guildState && user?.id === guildState.guild.ownerId);
  const profileOwnPermissions = guildState
    ? profileIsOwner
      ? ALL_PERMISSIONS
      : BigInt(guildState.permissions)
    : 0n;
  const profileCanAssignRoles = can(profileOwnPermissions, Permission.ASSIGN_ROLES);
  const profileOwnHighestPosition = guildState
    ? profileIsOwner
      ? Number.POSITIVE_INFINITY
      : guildState.member.roles
          .map((roleId) => guildState.roles.find((r) => r.id === roleId)?.position ?? 0)
          .reduce((max, p) => Math.max(max, p), 0)
    : 0;
  /**
   * Ekran paylaşımı tam ekran modu: kim odaklandıysa o kullanıcının id'si.
   * null iken normal görünüm (VoiceStage şerit + sohbet birlikte). Dolu iken
   * sohbet TAMAMEN gizlenir, VoiceStage tam alanı kaplar (bkz. VoiceStage.tsx
   * yorumu — eskiden ikisi hep birlikte gösteriliyordu, kullanıcı bunu
   * "bölünmüş" bulup değiştirilmesini istedi).
   */
  const [focusedPresenterId, setFocusedPresenterId] = useState<string | null>(null);

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

  // Mesaj satırlarında isim/saat rengi: üyenin en yüksek konumlu RENKLİ
  // rolü (Discord kuralı — @everyone'un rengi yoktur, sıradaki adaya geçilir).
  // Renk yoksa haritada hiç kayıt yok — MessageRow varsayılan rengi kullanır.
  const userColors = useMemo(() => {
    const map = new Map<string, number>();
    const roles = guildState?.roles ?? [];
    for (const member of members) {
      const colored = roles
        .filter((r) => r.id !== activeGuildId && r.color !== 0 && member.roles.includes(r.id))
        .sort((a, b) => b.position - a.position)[0];
      if (colored) map.set(member.user.id, colored.color);
    }
    return map;
  }, [members, guildState, activeGuildId]);

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

  /**
   * Bağlı olduğum ses kanalının kendi sohbet paneli için bağlam — bu kanal
   * ŞU AN görüntülenen sunucuda olmayabilir (bkz. VoiceControlBar'daki aynı
   * arama deseni), o yüzden `guilds` haritasının tamamında aranıyor.
   */
  const voiceChannelId = store.voiceChannelId;
  let voiceChatGuildState: GuildState | undefined;
  let voiceChatChannel: APIChannel | undefined;
  for (const g of guilds.values()) {
    const ch = g.channels.find((c) => c.id === voiceChannelId);
    if (ch) {
      voiceChatGuildState = g;
      voiceChatChannel = ch;
      break;
    }
  }
  // Zorla taşındığım kanal (bkz. buildForcedChannel) hiçbir guildState'in
  // channels listesinde yok — bulunamadıysa sentetik kayda düş, yoksa bu
  // kanalın sohbet paneli hiç açılmaz (kullanıcı raporu: o an kanaldaysa
  // sohbeti görebilmeli).
  if (!voiceChatChannel && store.forcedVoiceChannelInfo && voiceChannelId) {
    const forcedGuildState = guilds.get(store.forcedVoiceChannelInfo.guildId);
    if (forcedGuildState) {
      const forced = buildForcedChannel(
        forcedGuildState.guild.id,
        forcedGuildState.channels,
        store.forcedVoiceChannelInfo,
        voiceChannelId,
      );
      if (forced) {
        voiceChatGuildState = forcedGuildState;
        voiceChatChannel = forced;
      }
    }
  }
  const voiceChatMembers = voiceChatGuildState
    ? (store.members.get(voiceChatGuildState.guild.id) ?? EMPTY_MEMBERS)
    : EMPTY_MEMBERS;
  const voiceChatUserNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of voiceChatMembers) {
      map.set(member.user.id, member.nickname ?? member.user.displayName ?? member.user.username);
    }
    return map;
  }, [voiceChatMembers]);
  const voiceChatRoleNames = useMemo(
    () => new Map((voiceChatGuildState?.roles ?? []).map((role) => [role.id, role.name])),
    [voiceChatGuildState],
  );
  const voiceChatUserColors = useMemo(() => {
    const map = new Map<string, number>();
    const roles = voiceChatGuildState?.roles ?? [];
    for (const member of voiceChatMembers) {
      const colored = roles
        .filter((r) => r.id !== voiceChatGuildState?.guild.id && r.color !== 0 && member.roles.includes(r.id))
        .sort((a, b) => b.position - a.position)[0];
      if (colored) map.set(member.user.id, colored.color);
    }
    return map;
  }, [voiceChatMembers, voiceChatGuildState]);
  const voiceChatPermissions =
    voiceChatGuildState && voiceChatChannel
      ? channelPermissions(voiceChatGuildState, voiceChatChannel)
      : 0n;

  // Kanal değişince yanıt hedefi düşer — başka kanalda yanıtlamak anlamsız.
  useEffect(() => setReplyTo(null), [activeChannelId]);

  // Açılışta arkadaşları ve bekleyen istekleri yükle.
  useEffect(() => {
    void api
      .get<APIFriendship[]>('/users/@me/friends')
      .then((list) => store.setFriends(list))
      .catch(() => undefined);

    void api
      .get<APIBlock[]>('/users/@me/blocks')
      .then((list) => store.setBlocks(list))
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
    // Sesli kanalın kendisi bir "okundu" kavramına sahip değil — orada
    // gösterilen katılımcı ızgarası mesaj listesi değil (bkz. VoiceStage.tsx).
    if (!activeChannelId || !lastMessageId || channel?.type === ChannelType.GUILD_VOICE) return;

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

  // Kanal deÄŸiÅŸince geÃ§miÅŸi yÃ¼kle. Sesli kanalda ana panel metin göstermiyor
  // (bkz. VoiceStage.tsx) — o kanalın kendi mesajları varsa bile burada
  // çekmeye gerek yok, VoiceChannelChatPanel açıldığında KENDİSİ çeker.
  useEffect(() => {
    if (!activeChannelId || channel?.type === ChannelType.GUILD_VOICE) return;
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
      // 1000: sunucunun izin verdiği tavan (bkz. guilds.ts) — üye listesi
      // "sunucuya daha önce katılmış herkesi" göstermeli, ilk 200'le kesmemeli.
      .get<APIGuildMember[]>(`/guilds/${activeGuildId}/members?limit=1000`)
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
                onClick={() => setDeveloperPortalOpen(true)}
                aria-label={t('developers.title')}
                title={t('developers.title')}
                className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
              >
                <Bot size={17} />
              </button>
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
          {/* Üye listesini göster/gizle — kapatınca panel kaybolur, bu düğme
              her zaman görünür kalır ki geri açılabilsin. */}
          {guildState && (
            <button
              type="button"
              onClick={() => store.setMemberListVisible(!store.memberListVisible)}
              aria-label={store.memberListVisible ? t('memberGroups.hide') : t('memberGroups.show')}
              title={store.memberListVisible ? t('memberGroups.hide') : t('memberGroups.show')}
              aria-pressed={store.memberListVisible}
              className={`rounded p-1.5 hover:bg-[var(--color-surface-2)] ${
                store.memberListVisible
                  ? 'text-[var(--color-brand)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Users size={18} />
            </button>
          )}
        </header>

        {channel?.type === ChannelType.GUILD_VOICE ? (
          <VoiceStage
            channelId={channel.id}
            focusedPresenterId={focusedPresenterId}
            onFocus={setFocusedPresenterId}
          />
        ) : channel ? (
          <>
            <MessageList
              messages={messages}
              currentUserId={user?.id ?? null}
              canManageMessages={canManageMessages}
              userNames={userNames}
              roleNames={roleNames}
              userColors={userColors}
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

      {store.voiceChatOpen && voiceChannelId && voiceChatChannel && (
        <VoiceChannelChatPanel
          channelId={voiceChannelId}
          channelName={voiceChatChannel.name ?? ''}
          permissions={voiceChatPermissions}
          userNames={voiceChatUserNames}
          roleNames={voiceChatRoleNames}
          userColors={voiceChatUserColors}
          onOpenProfile={setProfileUser}
          onClose={() => store.setVoiceChatOpen(false)}
        />
      )}

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
      {developerPortalOpen && <DeveloperPortal onClose={() => setDeveloperPortalOpen(false)} />}

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
          guildId={guildState?.guild.id}
          canAssignRoles={profileCanAssignRoles}
          ownHighestPosition={profileOwnHighestPosition}
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
  const isAdmin = useStore((s) => s.user?.isAdmin ?? false);
  const [modalOpen, setModalOpen] = useState(false);
  /**
   * Yönetici paneli erişimi BURADA da var — kullanıcı çubuğundaki küçük
   * kalkan ikonuna ek olarak, sunucu şeridinin EN ÜSTÜNDE her zaman görünür
   * (bkz. kullanıcı raporu: admin girişi "normal kullanıcıdan farksız"
   * görünüyordu — hiç sunucusu olmayan bir admin hesabında alt kullanıcı
   * çubuğu görünse de küçük ikon gözden kaçabiliyordu). Kendi state'i var,
   * ChatShell'deki adminOpen'dan BAĞIMSIZ — ikisi de aynı AdminPanel'i açar.
   */
  const [adminOpen, setAdminOpen] = useState(false);
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

      {isAdmin && (
        <button
          type="button"
          title={t('admin.title')}
          aria-label={t('admin.title')}
          onClick={() => setAdminOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-3xl bg-[var(--color-brand)]/20 text-[var(--color-brand)] transition-all hover:rounded-2xl hover:bg-[var(--color-brand)] hover:text-black"
        >
          <ShieldCheck size={20} />
        </button>
      )}

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
              initialsFromName(state.guild.name)
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

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

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
          const readState = readStates.get(channel.id);
          const mentionCount = readState?.mentionCount ?? 0;
          const unreadCount = readState?.unreadCount ?? 0;

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
                {initialsFromName(label)}
              </span>
              <span className="truncate">{label}</span>
              {(() => {
                const otherUnread = unreadCount - mentionCount;
                return (
                  <>
                    {otherUnread > 0 && (
                      <span className="ml-auto rounded-full bg-[var(--color-surface-3)] px-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                        {otherUnread > 99 ? '99+' : otherUnread}
                      </span>
                    )}
                    {mentionCount > 0 && (
                      <span
                        className={`${otherUnread > 0 ? '' : 'ml-auto'} rounded-full bg-[var(--color-dnd)] px-1.5 text-xs font-semibold text-white`}
                      >
                        {mentionCount > 99 ? '99+' : mentionCount}
                      </span>
                    )}
                  </>
                );
              })()}
            </button>
          );
        })}
      </div>
    </>
  );
}

function ChannelList({ onNavigate }: NavProps) {
  const { t } = useTranslation();
  const {
    guilds,
    activeGuildId,
    activeChannelId,
    setActive,
    readStates,
    channelDragLockCount,
    forcedVoiceChannelInfo,
    voiceChannelId,
  } = useStore();
  const [moderationOpen, setModerationOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<APIChannel | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  /** Sürüklenen kanalın id'si ve bırakılacak yuva — sürükle-bırak sıralama. */
  const [dragChannelId, setDragChannelId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' } | null>(
    null,
  );
  /**
   * Bir katılımcıyı sürükleyip üstüne getirdiğimiz sesli kanal — kanal
   * sıralaması sürüklemesinden (dropTarget) AYRI: MOVE_MEMBERS izniyle bir
   * kullanıcıyı doğrudan başka bir sesli kanala taşımak için (bkz.
   * VoiceChannel.tsx VOICE_USER_DRAG_TYPE).
   */
  const [userDropTargetId, setUserDropTargetId] = useState<string | null>(null);
  /**
   * Ses kanalı/kullanıcı sağ tık menüsü — TÜM sesli kanallar için TEK state
   * (bkz. VoiceChannel.tsx VoiceMenuState yorumu): aynı anda birden fazla
   * kanalın/kullanıcının menüsü açık kalmasın diye burada, ChannelList
   * seviyesinde tutuluyor.
   */
  const [voiceMenu, setVoiceMenu] = useState<(VoiceMenuState & { channelId: string }) | null>(
    null,
  );
  const menu = useContextMenu();
  const state = activeGuildId ? guilds.get(activeGuildId) : undefined;

  /** Kanala sağ tık menüsü — yönetim izni olana ayarlar/sil. */
  function channelMenu(channel: APIChannel): MenuItem[] {
    const items: MenuItem[] = [];
    // Kanal Ayarları'nı açmak MANAGE_CHANNELS gerektirir — sadece sıralama
    // (REORDER_CHANNELS) izni olan bir role, kaydedemeyeceği bir ekranı
    // gösterip sonra sunucudan 403 almasındansa hiç göstermeyelim.
    if (canManage) {
      items.push({
        label: t('channelSettings.open'),
        icon: <Settings size={15} />,
        onClick: () => setSettingsChannel(channel),
      });
    }
    if (canReorder) {
      const siblings = siblingsOf(channel);
      const index = siblings.findIndex((c) => c.id === channel.id);
      items.push(
        {
          label: t('channel.moveUp'),
          icon: <ArrowUp size={15} />,
          disabled: index <= 0,
          onClick: () => void moveChannel(channel, -1),
        },
        {
          label: t('channel.moveDown'),
          icon: <ArrowDown size={15} />,
          disabled: index === -1 || index >= siblings.length - 1,
          onClick: () => void moveChannel(channel, 1),
        },
      );
    }
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
  // Kategorisiz kanallar artık TEK bir karışık liste değil, Discord'daki gibi
  // METİN / SES olarak iki ayrı grupta gösteriliyor (bkz. sıralama yardımcıları
  // aşağıda) — sıralama da grup içinde bağımsız.
  const uncategorizedText = state.channels
    .filter((c) => c.type === ChannelType.GUILD_TEXT && !c.parentId)
    .sort((a, b) => a.position - b.position);
  const uncategorizedVoice = state.channels
    .filter((c) => c.type === ChannelType.GUILD_VOICE && !c.parentId)
    .sort((a, b) => a.position - b.position);

  const guildPerms = BigInt(state.permissions);
  const canManage = can(guildPerms, Permission.MANAGE_CHANNELS);
  // Bir profil kartı/kullanıcı ayarları modalı açıkken sürüklemeyi kilitle —
  // bkz. store'daki channelDragLockCount ve UserSettings/ProfilePopout'taki efekt.
  const canReorder = can(guildPerms, Permission.REORDER_CHANNELS) && channelDragLockCount === 0;
  const canServerMute = can(guildPerms, Permission.MUTE_MEMBERS);
  const canMoveMembers = can(guildPerms, Permission.MOVE_MEMBERS);
  const canDisconnectMembers = can(guildPerms, Permission.DISCONNECT_MEMBERS);
  const voiceChannels = state.channels.filter((c) => c.type === ChannelType.GUILD_VOICE);
  // Sentetik ses kanalı — bkz. buildForcedChannel yorumu (paylaşılan, ana
  // paneldeki `channel` hesaplamasıyla AYNI mantık).
  const forcedChannel: APIChannel | null = buildForcedChannel(
    state.guild.id,
    state.channels,
    forcedVoiceChannelInfo,
    voiceChannelId,
  );
  const canCreateText = can(guildPerms, Permission.CREATE_TEXT_CHANNELS);
  const canCreateVoice = can(guildPerms, Permission.CREATE_VOICE_CHANNELS);
  // Rol atama (ASSIGN_ROLES) yetkisi olan ama rol TANIMLARINI düzenleme
  // yetkisi (MANAGE_ROLES) olmayan biri de Roller ekranını açabilmeli —
  // orada yalnızca "Bu roldeki üyeler" bölümünü kullanabilecek (bkz.
  // RoleSettings.tsx canEditRoleDefs).
  const canManageRoles =
    can(guildPerms, Permission.MANAGE_ROLES) || can(guildPerms, Permission.ASSIGN_ROLES);
  const canInvite = can(guildPerms, Permission.CREATE_INVITE);
  // Moderasyon düğmesi: bu izinlerden herhangi biri yeterli.
  const canModerate =
    can(guildPerms, Permission.KICK_MEMBERS) ||
    can(guildPerms, Permission.BAN_MEMBERS) ||
    can(guildPerms, Permission.MODERATE_MEMBERS) ||
    can(guildPerms, Permission.VIEW_AUDIT_LOG) ||
    can(guildPerms, Permission.MANAGE_GUILD);

  /**
   * Bir kanalın "kardeşleri": aynı ebeveyn (kategori ya da kök). Kökteyse
   * (parentId yok) METİN ve SES ayrı listelendiği için kardeşlik de tipe
   * göre ayrılır — "yukarı taşı" bir metin kanalını bir ses kanalının
   * üstüne geçirmez, kendi grubunda bir sıra kaydırır.
   */
  function siblingsOf(channel: APIChannel): APIChannel[] {
    return state!.channels
      .filter(
        (c) =>
          c.type !== ChannelType.GUILD_CATEGORY &&
          c.parentId === channel.parentId &&
          (channel.parentId !== null || c.type === channel.type),
      )
      .sort((a, b) => a.position - b.position);
  }

  /** İki kanal aynı sıralama grubunda mı — `siblingsOf` ile aynı kural. */
  function sameReorderGroup(a: APIChannel, b: APIChannel): boolean {
    if (a.parentId !== b.parentId) return false;
    return a.parentId !== null || a.type === b.type;
  }

  /**
   * Kanalı kendi grubunda `targetIndex` konumuna taşır.
   *
   * Pozisyonları TEK TEK TAKAS ETMEK yerine tüm kardeş grubu yeniden
   * numaralandırıyoruz: yeni kanallar varsayılan olarak position=0 ile
   * oluşturuluyor, yani çoğu kanalın pozisyonu aynı — iki eşit değeri takas
   * etmek görünürde hiçbir şey değiştirmez.
   */
  async function moveChannelToIndex(channel: APIChannel, targetIndex: number) {
    const siblings = siblingsOf(channel);
    const index = siblings.findIndex((c) => c.id === channel.id);
    if (index === -1 || targetIndex === index) return;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;

    const reordered = [...siblings];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);

    await Promise.all(
      reordered.map((c, i) =>
        c.position === i ? null : api.patch(`/channels/${c.id}`, { position: i }).catch(() => null),
      ),
    );
  }

  /** Bir sıra yukarı/aşağı (sağ tık menüsü). */
  async function moveChannel(channel: APIChannel, direction: -1 | 1) {
    const siblings = siblingsOf(channel);
    const index = siblings.findIndex((c) => c.id === channel.id);
    if (index === -1) return;
    await moveChannelToIndex(channel, index + direction);
  }

  /**
   * Sürüklenen kanalı hedefin üstüne/altına bırakır.
   *
   * `edge === 'after'` ise hedeften sonraki yuvaya gider. Sürüklenen kanal
   * listeden çıkarıldığında kendisinden SONRAKİ tüm indeksler bir azalır;
   * bu yüzden yukarıdan aşağı taşımada hedef indeksi bir geri çekiyoruz —
   * atlanırsa kanal hep bir fazla ilerler.
   */
  async function dropChannelOn(target: APIChannel, edge: 'before' | 'after') {
    const dragged = state!.channels.find((c) => c.id === dragChannelId);
    if (!dragged || dragged.id === target.id) return;
    if (!sameReorderGroup(dragged, target)) return;

    const siblings = siblingsOf(dragged);
    const from = siblings.findIndex((c) => c.id === dragged.id);
    let to = siblings.findIndex((c) => c.id === target.id);
    if (to === -1 || from === -1) return;
    if (edge === 'after') to += 1;
    if (from < to) to -= 1;
    await moveChannelToIndex(dragged, to);
  }

  /** Bir katılımcıyı sürükle-bırak ile başka bir sesli kanala taşı (bkz. VoiceChannel.tsx sağ tık menüsündeki "Taşı" ile aynı uç). */
  async function moveMemberToChannel(userId: string, targetChannelId: string) {
    await api
      .put(`/guilds/${state!.guild.id}/members/${userId}/voice-move`, { channelId: targetChannelId })
      .catch(() => undefined); // 403/hiyerarşi hatası — sessizce geç
  }

  // Sağ tık menüsü ya genel ayarlar (canManage) ya da yalnızca sıralama
  // (canReorder) için açılabilir — ikisinden biri yeterli.
  const canOpenChannelMenu = canManage || canReorder;

  /** Kanalı tipine göre çiz: sesli kanal katıl/roster, metin kanalı buton. */
  function renderChannel(channel: APIChannel) {
    const inner =
      channel.type === ChannelType.GUILD_VOICE ? (
        <VoiceChannelItem
          channel={channel}
          canServerMute={canServerMute}
          canMoveMembers={canMoveMembers}
          canDisconnectMembers={canDisconnectMembers}
          voiceChannels={voiceChannels}
          menu={voiceMenu && voiceMenu.channelId === channel.id ? voiceMenu : null}
          onOpenMenu={(state) => setVoiceMenu({ ...state, channelId: channel.id })}
          onCloseMenu={() => setVoiceMenu(null)}
          // Ses kanalının sağ tık menüsü TEK sekmede birleşik: ses seviyesi +
          // (izne göre) kanal ayarları/sıralama — bkz. VoiceChannel.tsx
          // yorumu. Ayrı bir dış "kanal ayarları" menüsü olmadığı için
          // burası her zaman `channelMenu(channel)` sonucunu iletir.
          extraMenuItems={canOpenChannelMenu ? channelMenu(channel) : []}
          onNavigate={onNavigate}
        />
      ) : (
        <ChannelButton
          name={channel.name ?? ''}
          locked={channel.locked}
          active={channel.id === activeChannelId}
          unread={isUnread(channel)}
          unreadCount={readStates.get(channel.id)?.unreadCount ?? 0}
          mentionCount={readStates.get(channel.id)?.mentionCount ?? 0}
          onClick={() => {
            setActive(state!.guild.id, channel.id);
            onNavigate();
          }}
        />
      );

    const dragged = dragChannelId
      ? (state!.channels.find((c) => c.id === dragChannelId) ?? null)
      : null;
    // Bırakma çizgisi yalnızca AYNI grupta gösterilir: metin kanalını ses
    // kanallarının arasına bırakmak sunucu tarafında da anlamsız olurdu.
    const droppable =
      dragged !== null && dragged.id !== channel.id && sameReorderGroup(dragged, channel);
    const indicator = droppable && dropTarget?.id === channel.id ? dropTarget.edge : null;
    // Sürüklenen bir katılımcı bu (sesli) kanalın üstünde mi — kanal
    // sıralamasından bağımsız, MOVE_MEMBERS taşıma hedefi.
    const isUserDropTarget =
      channel.type === ChannelType.GUILD_VOICE && canMoveMembers && userDropTargetId === channel.id;

    return (
      <div
        key={channel.id}
        draggable={canReorder}
        // Ses kanalları KENDİ birleşik sağ tık menüsünü yönetiyor (bkz.
        // VoiceChannelItem extraMenuItems) — burada ikinci bir menü açmak
        // tam da giderdiğimiz "iki farklı menü" karışıklığını geri getirir.
        onContextMenu={
          channel.type !== ChannelType.GUILD_VOICE && canOpenChannelMenu
            ? (e) => menu.open(e, channelMenu(channel))
            : undefined
        }
        onDragStart={(e) => {
          setDragChannelId(channel.id);
          e.dataTransfer.effectAllowed = 'move';
          // Firefox sürüklemeyi ancak veri taşındığında başlatır.
          e.dataTransfer.setData('text/plain', channel.id);
        }}
        onDragEnd={() => {
          setDragChannelId(null);
          setDropTarget(null);
        }}
        onDragOver={(e) => {
          // Bir katılımcı sürükleniyorsa (kanal sıralamasından AYRI akış):
          // yalnızca sesli kanallar hedef olabilir, "before/after" çizgisi yok
          // — tüm satır vurgulanır (bkz. isUserDropTarget).
          if (e.dataTransfer.types.includes(VOICE_USER_DRAG_TYPE)) {
            if (channel.type !== ChannelType.GUILD_VOICE || !canMoveMembers) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (userDropTargetId !== channel.id) setUserDropTargetId(channel.id);
            return;
          }
          if (!droppable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const box = e.currentTarget.getBoundingClientRect();
          const edge = e.clientY < box.top + box.height / 2 ? 'before' : 'after';
          if (dropTarget?.id !== channel.id || dropTarget.edge !== edge) {
            setDropTarget({ id: channel.id, edge });
          }
        }}
        onDragLeave={() => {
          if (dropTarget?.id === channel.id) setDropTarget(null);
          if (userDropTargetId === channel.id) setUserDropTargetId(null);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes(VOICE_USER_DRAG_TYPE)) {
            e.preventDefault();
            setUserDropTargetId(null);
            if (channel.type !== ChannelType.GUILD_VOICE || !canMoveMembers) return;
            const userId = e.dataTransfer.getData(VOICE_USER_DRAG_TYPE);
            if (userId) void moveMemberToChannel(userId, channel.id);
            return;
          }
          if (!droppable || !indicator) return;
          e.preventDefault();
          void dropChannelOn(channel, indicator);
          setDragChannelId(null);
          setDropTarget(null);
        }}
        className={`${canReorder ? 'cursor-grab active:cursor-grabbing' : ''} ${
          dragChannelId === channel.id ? 'opacity-40' : ''
        } ${isUserDropTarget ? 'rounded bg-[var(--color-brand)]/15 ring-1 ring-[var(--color-brand)]' : ''} ${
          indicator === 'before'
            ? 'border-t-2 border-[var(--color-brand)]'
            : indicator === 'after'
              ? 'border-b-2 border-[var(--color-brand)]'
              : 'border-y-2 border-transparent'
        }`}
      >
        {inner}
      </div>
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

    setInviteUrl(`${location.origin}/davet/${invite.code}`);
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
          {(canCreateText || canCreateVoice) && (
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
        <ChannelCreateModal
          guildId={activeGuildId}
          canCreateText={canCreateText}
          canCreateVoice={canCreateVoice}
          roles={state.roles}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {inviteUrl && <InviteLinkModal url={inviteUrl} onClose={() => setInviteUrl(null)} />}

      {moderationOpen && (
        <ModerationPanel guildState={state} onClose={() => setModerationOpen(false)} />
      )}

      {rolesOpen && <RoleSettings guildState={state} onClose={() => setRolesOpen(false)} />}

      <div className="flex-1 overflow-y-auto p-2">
        {uncategorizedText.length > 0 && (
          <div>
            <div className="px-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('channel.textChannels')}
            </div>
            {uncategorizedText.map(renderChannel)}
          </div>
        )}

        {(uncategorizedVoice.length > 0 || forcedChannel) && (
          <div className={uncategorizedText.length > 0 ? 'mt-3' : ''}>
            <div className="px-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {t('channel.voiceChannels')}
            </div>
            {uncategorizedVoice.map(renderChannel)}
            {forcedChannel && (
              <div className="border-y-2 border-transparent">
                <VoiceChannelItem
                  channel={forcedChannel}
                  canServerMute={canServerMute}
                  canMoveMembers={canMoveMembers}
                  canDisconnectMembers={canDisconnectMembers}
                  voiceChannels={voiceChannels}
                  menu={voiceMenu && voiceMenu.channelId === forcedChannel.id ? voiceMenu : null}
                  onOpenMenu={(menuState) => setVoiceMenu({ ...menuState, channelId: forcedChannel.id })}
                  onCloseMenu={() => setVoiceMenu(null)}
                  // Bu satır sentetik — VIEW_CHANNEL'im olmayan bir kanal,
                  // gerçek bir kanal kaydı değil, kanal ayarları/sıralama
                  // burada anlamsız.
                  extraMenuItems={[]}
                  onNavigate={onNavigate}
                />
              </div>
            )}
          </div>
        )}

        {categories.map((category) => (
          <div key={category.id} className="mt-3">
            <div className="px-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
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

/** Sağ tık menüsü ve sürükleme, saran kapsayıcıda ele alınır (bkz. renderChannel). */
function ChannelButton({
  name,
  active,
  locked,
  unread,
  unreadCount,
  mentionCount,
  onClick,
}: {
  name: string;
  active: boolean;
  locked: boolean;
  unread: boolean;
  unreadCount: number;
  mentionCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-base ${
        active
          ? 'bg-[var(--color-surface-3)] text-[var(--color-ink)]'
          : unread
            ? 'font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]'
            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
      }`}
    >
      {locked ? <Lock size={16} /> : <Hash size={16} />}
      <span className="truncate">{name}</span>

      {/* İkisi de bağımsız gösterilir: bahsetme (kırmızı) diğer okunmamışları
          EZMEZ — biri gelince öbürü kaybolursa "normal mesajlar okunmadı"
          bilgisi kaybolurdu (bkz. kullanıcı raporu). Gri rozet mentionCount'u
          TEKRAR SAYMAZ, yalnızca bahsetme OLMAYAN okunmamışları gösterir. */}
      {(() => {
        const otherUnread = unreadCount - mentionCount;
        return (
          <>
            {otherUnread > 0 && !active && (
              <span className="ml-auto rounded-full bg-[var(--color-surface-3)] px-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                {otherUnread > 99 ? '99+' : otherUnread}
              </span>
            )}
            {mentionCount > 0 && (
              <span
                className={`${otherUnread > 0 && !active ? '' : 'ml-auto'} rounded-full bg-[var(--color-dnd)] px-1.5 text-xs font-semibold text-white`}
              >
                {mentionCount > 99 ? '99+' : mentionCount}
              </span>
            )}
            {mentionCount === 0 && otherUnread <= 0 && unread && !active && (
              <span className="ml-auto h-2 w-2 rounded-full bg-[var(--color-ink)]" />
            )}
          </>
        );
      })()}
    </button>
  );
}

/**
 * Üye listesi gruplaması: sunucu sahibi hep en üstte (çevrimdışı olsa bile —
 * "hep" burada gerçekten hep demek), sonra hoisted (ayrı gösterilen) roller
 * pozisyona göre (yüksek pozisyon önce, bkz. `highestRolePosition`), her
 * grup içinde ada göre sıralı. Bir üyenin birden fazla hoisted rolü varsa
 * EN YÜKSEK pozisyonlu role göre gruplanır — iki grupta birden görünmez.
 * Hiç hoisted rolü olmayan çevrimiçi üyeler "Çevrimiçi" havuzuna düşer.
 * "Yalnızca çevrimiçi" modunda çevrimdışılar (sahip hariç) hiç gösterilmez.
 */
function groupMembers(
  members: readonly APIGuildMember[],
  roles: readonly APIRole[],
  ownerId: string,
  presence: Map<string, PresenceStatus>,
  mode: 'all' | 'online',
) {
  const byName = (a: APIGuildMember, b: APIGuildMember) =>
    (a.nickname ?? a.user.displayName ?? a.user.username).localeCompare(
      b.nickname ?? b.user.displayName ?? b.user.username,
      'tr',
    );
  const isOnline = (userId: string) => (presence.get(userId) ?? 'offline') !== 'offline';

  const owner = members.find((m) => m.user.id === ownerId) ?? null;
  const rest = members.filter((m) => m.user.id !== ownerId);

  const hoisted = [...roles].filter((r) => r.hoist).sort((a, b) => b.position - a.position);
  const roleGroups = hoisted.map((role) => ({ role, members: [] as APIGuildMember[] }));
  const defaultOnline: APIGuildMember[] = [];
  const offline: APIGuildMember[] = [];

  for (const member of rest) {
    if (!isOnline(member.user.id)) {
      if (mode === 'all') offline.push(member);
      continue;
    }
    const group = roleGroups.find((g) => member.roles.includes(g.role.id));
    (group ? group.members : defaultOnline).push(member);
  }

  for (const group of roleGroups) group.members.sort(byName);
  defaultOnline.sort(byName);
  offline.sort(byName);

  return { owner, roleGroups, defaultOnline, offline };
}

function MemberList({ onOpenProfile }: { onOpenProfile: (member: APIGuildMember) => void }) {
  const { t } = useTranslation();
  const { members, guilds, activeGuildId, presence, memberListVisible, memberListMode, setMemberListMode } =
    useStore();
  const list = activeGuildId ? (members.get(activeGuildId) ?? []) : [];
  const guildState = activeGuildId ? guilds.get(activeGuildId) : undefined;

  const grouped = useMemo(
    () =>
      guildState
        ? groupMembers(list, guildState.roles, guildState.guild.ownerId, presence, memberListMode)
        : null,
    [list, guildState, presence, memberListMode],
  );

  if (!activeGuildId || !memberListVisible || !grouped) return null;

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-[var(--color-surface-1)] lg:flex">
      <header className="flex h-12 items-center gap-2 border-b border-[var(--color-line)] px-4 text-sm text-[var(--color-ink-muted)]">
        <Users size={16} />
        {t('guild.memberCount', { count: list.length })}
      </header>

      <div className="flex items-center gap-1 border-b border-[var(--color-line)] px-2 py-2">
        <ModeButton active={memberListMode === 'all'} onClick={() => setMemberListMode('all')}>
          {t('memberGroups.showAll')}
        </ModeButton>
        <ModeButton active={memberListMode === 'online'} onClick={() => setMemberListMode('online')}>
          {t('memberGroups.onlyOnline')}
        </ModeButton>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {grouped.owner && (
          <MemberGroup
            label={t('memberGroups.owner')}
            members={[grouped.owner]}
            presence={presence}
            onOpenProfile={onOpenProfile}
          />
        )}
        {grouped.roleGroups.map(({ role, members: roleMembers }) => (
          <MemberGroup
            key={role.id}
            label={`${role.name} — ${roleMembers.length}`}
            labelColor={role.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined}
            members={roleMembers}
            presence={presence}
            onOpenProfile={onOpenProfile}
          />
        ))}
        <MemberGroup
          label={t('memberGroups.online', { count: grouped.defaultOnline.length })}
          members={grouped.defaultOnline}
          presence={presence}
          onOpenProfile={onOpenProfile}
        />
        {memberListMode === 'all' && (
          <MemberGroup
            label={t('memberGroups.offline', { count: grouped.offline.length })}
            members={grouped.offline}
            presence={presence}
            dim
            onOpenProfile={onOpenProfile}
          />
        )}
      </div>
    </aside>
  );
}

function ModeButton({
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
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-medium transition ${
        active
          ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]'
          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function MemberGroup({
  label,
  labelColor,
  members,
  presence,
  dim,
  onOpenProfile,
}: {
  label: string;
  labelColor?: string;
  members: APIGuildMember[];
  presence: Map<string, PresenceStatus>;
  dim?: boolean;
  onOpenProfile: (member: APIGuildMember) => void;
}) {
  if (members.length === 0) return null;
  return (
    <div className="mb-3">
      <div
        className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"
        style={labelColor ? { color: labelColor } : undefined}
      >
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
