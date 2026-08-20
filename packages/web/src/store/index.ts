/**
 * İstemci durumu (Zustand).
 *
 * Sunucudan gelen veri TanStack Query'de değil burada tutuluyor: gateway
 * olayları durumu sürekli iterek güncelliyor, bu da "sunucu durumu" değil
 * canlı bir yerel model. Query yalnızca ilk yükleme ve sayfalama için.
 */

import { create } from 'zustand';
import { ChannelType, computeBasePermissions } from '@tuscord/shared';
import type {
  APIBlock,
  APIChannel,
  APIGuild,
  APIGuildMember,
  APIMessage,
  APIRole,
  APIFriendship,
  PresenceStatus,
  PublicUser,
  ReadState,
  ReadyGuild,
  SelfUser,
  Snowflake,
  VoiceStateUpdatePayload,
} from '@tuscord/shared';
import type { GatewayStatus } from '../lib/gateway';
import {
  loadChannelVolumes,
  loadInputDeviceId,
  loadInputSensitivity,
  loadMutedPeerIds,
  loadNoiseSuppression,
  loadOutputDeviceId,
  loadOutputVolume,
  loadPushToTalk,
  loadPushToTalkKey,
  loadUserVolumes,
  saveChannelVolumes,
  saveInputDeviceId,
  saveInputSensitivity,
  saveMutedPeerIds,
  saveNoiseSuppression,
  saveOutputDeviceId,
  saveOutputVolume,
  savePushToTalk,
  savePushToTalkKey,
  saveUserVolumes,
} from '../lib/voicePrefs';

export interface GuildState {
  guild: APIGuild;
  channels: APIChannel[];
  roles: APIRole[];
  member: APIGuildMember;
  memberCount: number;
  permissions: string;
}

/** Bir ses kanalındaki tek katılımcı. */
export interface VoiceParticipant {
  user: PublicUser;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Ekran paylaşıyor mu. */
  selfVideo: boolean;
}

interface AppState {
  user: SelfUser | null;
  status: GatewayStatus;
  guilds: Map<Snowflake, GuildState>;
  /** kanal → mesajlar (eskiden yeniye sıralı). */
  messages: Map<Snowflake, APIMessage[]>;
  members: Map<Snowflake, APIGuildMember[]>;
  presence: Map<Snowflake, PresenceStatus>;
  /** kanal → yazan kullanıcılar ve son sinyal zamanı. */
  typing: Map<Snowflake, Map<Snowflake, number>>;
  /** kanal → okundu durumu. Kanal listesindeki rozetler buradan çizilir. */
  readStates: Map<Snowflake, { lastReadMessageId: Snowflake | null; mentionCount: number; unreadCount: number }>;
  /** DM ve grup DM kanalları. */
  privateChannels: APIChannel[];
  /** true ise sunucu yerine DM görünümü açık. */
  dmView: boolean;
  /** Arkadaşlar + bekleyen istekler. */
  friends: APIFriendship[];
  /** Engellediğim kullanıcılar. */
  blocks: APIBlock[];
  activeGuildId: Snowflake | null;
  activeChannelId: Snowflake | null;
  /**
   * Kullanıcı bir sunucu oluşturdu/katıldı ve GUILD_CREATE olayı bekleniyor.
   * Olay gelince bu sunucu otomatik açılır — REST cevabı geldiğinde kanallar
   * henüz elimizde olmadığı için doğrudan seçemiyoruz.
   */
  pendingActiveGuildId: Snowflake | null;

  /** Sağdaki üye listesi paneli açık mı. localStorage'da kalıcı. */
  memberListVisible: boolean;
  /** 'all': çevrimdışılar da görünür. 'online': yalnızca çevrimiçiler. */
  memberListMode: 'all' | 'online';

  /**
   * Yeni mesaj/bahsetme sesi — varsayılan AÇIK, localStorage'da kalıcı.
   * Kalabalık sunucularda ayrıca otomatik susturulur (bkz. useGateway.ts
   * LARGE_GUILD_SOUND_THRESHOLD) — bu alan yalnızca kullanıcının kendi
   * tercihi, otomatik davranışı geçersiz kılmaz.
   */
  messageSounds: boolean;

  /**
   * "Görünmez" tercih — açıkken sunucuya IDENTIFY/PRESENCE_UPDATE ile
   * bildirilir, başkaları beni çevrimdışı görür (bkz. lib/gateway.ts
   * setInvisible, server gateway/index.ts setPresence). localStorage'da
   * kalıcı — bir sonraki bağlantıda da uygulanır.
   */
  invisible: boolean;

  /* ---- Ses (mesh P2P) ---- */
  /** Bağlı olduğum ses kanalı (yoksa null). */
  voiceChannelId: Snowflake | null;
  /** Bağlanma sürüyor (mikrofon izni/ilk el sıkışma). */
  voiceConnecting: boolean;
  /** kanal → (userId → katılımcı). Tüm sunucudaki ses odalarının roster'ı. */
  voiceStates: Map<Snowflake, Map<Snowflake, VoiceParticipant>>;
  /** Şu an konuşan kullanıcılar (ses seviyesi eşiği aşıldı). */
  voiceSpeaking: Set<Snowflake>;
  selfMute: boolean;
  selfDeaf: boolean;
  /** userId → ekran paylaşım akışı (video). Kendiminki de burada (önizleme). */
  screenStreams: Map<Snowflake, MediaStream>;
  /** Kendim ekran paylaşıyor muyum. */
  selfSharing: boolean;
  /**
   * Sesli kanala özel sohbet paneli açık mı — Discord'daki gibi, ses
   * kanalının kendi metin geçmişi (bkz. VoiceChannelChatPanel.tsx). Ses
   * kanalından ayrılınca resetVoiceSession ile kapanır.
   */
  voiceChatOpen: boolean;
  /**
   * Bir moderatör MUTE_MEMBERS ile susturduğu kullanıcılar (bkz.
   * VOICE_FORCE_MUTE). Susturulan kendi mikrofonunu açamaz; başkaları
   * roster'da kilit rozeti görür. Yalnızca ANLIK — sayfa yenilenince/kanal
   * değişince kaybolur (bkz. voice.ts yorumu: mesh P2P'de gerçek
   * sunucu-taraflı zorlama yok, bu iyi niyetli istemciler için bir istek).
   */
  serverMutedUserIds: Set<Snowflake>;
  /**
   * Kişisel ses karıştırma tercihlerim — YALNIZCA benim ne duyduğumu
   * etkiler, kimseye yansımaz. localStorage'da kalıcı (bkz. voicePrefs.ts).
   */
  channelVolumes: Map<Snowflake, number>; // 0-100, varsayılan 100
  userVolumes: Map<Snowflake, number>; // 0-100, varsayılan 100
  /** Sessize aldığım kullanıcılar (kayan çubuğu 0'a çekmeden hızlı geçiş). */
  mutedPeerIds: Set<Snowflake>;
  /**
   * Mikrofon algılama hassasiyeti: 0-100, düşük değer konuşma algısını daha
   * KOLAY tetikler (bkz. voice.ts SPEAKING_THRESHOLD hesaplaması). Kullanıcı
   * ayarlarından, canlı bir seviye göstergesiyle birlikte ayarlanır.
   */
  inputSensitivity: number;
  /** Tüm gelen seslere uygulanan ANA çıktı seviyesi — kanal/kullanıcı seviyelerinin ÜSTÜNE çarpılır. */
  outputVolume: number;
  /** Varsayılan AÇIK; kullanıcı kendi ayarlarından kapatabilir (bkz. kullanıcı raporu). */
  noiseSuppression: boolean;
  /** Seçili mikrofon/hoparlör cihaz id'si (yoksa tarayıcı varsayılanı). */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /**
   * Bas-konuş modu — açıkken mikrofon varsayılan olarak KAPALI, yalnızca
   * `pushToTalkKey` basılıyken açılır (bkz. voice.ts). Varsayılan KAPALI
   * (Discord'un "Ses Aktivasyonu" varsayılanıyla aynı) — kullanıcı açar.
   */
  pushToTalk: boolean;
  /** `KeyboardEvent.code` değeri, ör. "ControlRight". */
  pushToTalkKey: string;
  /** Bas-konuş AÇIKKEN, tuş şu an basılı mı — UI'da "konuşuyor" rozetini besler. */
  pushToTalkActive: boolean;
  /**
   * Kaç tane modal/popout kanal sürükle-bırak sıralamasını kilitliyor.
   * Sayaç (boolean değil): UserSettings ve ProfilePopout aynı anda açılırsa
   * biri kapanınca diğeri hâlâ kilidi tutmaya devam etmeli. Native HTML5
   * sürükleme, altındaki `draggable` satırların üstüne bindiği için tam
   * ekran kaplamayan/geçici modallar açıkken kanal listesi yanlışlıkla
   * sürüklenebiliyordu — bkz. ChatShell.tsx `canReorder`.
   */
  channelDragLockCount: number;
  /**
   * MOVE_MEMBERS ile VIEW_CHANNEL iznim olmayan bir kanala taşındığımda
   * doldurulur (bkz. voice.ts applyServerMove) — kanal normal listemde hiç
   * görünmeyeceği için adını/sunucusunu başka hiçbir yerden öğrenemem.
   * VoiceControlBar bunu kanal görünmezken düşer. Görünür bir kanala
   * geçince/ayrılınca temizlenir.
   */
  forcedVoiceChannelInfo: { name: string; guildId: Snowflake } | null;

  setUser: (user: SelfUser | null) => void;
  setPendingActiveGuild: (guildId: Snowflake | null) => void;
  setMemberListVisible: (visible: boolean) => void;
  setMemberListMode: (mode: 'all' | 'online') => void;
  setMessageSounds: (enabled: boolean) => void;
  /** Saf state güncellemesi — gerçek zamanlı sunucu bildirimi için lib/gateway.ts setInvisible'ı kullan. */
  setInvisible: (value: boolean) => void;
  /** Bir kanaldaki okunmamış sayacını artırır (bkz. useGateway.ts MESSAGE_CREATE). */
  bumpUnread: (channelId: Snowflake, mention: boolean) => void;
  setStatus: (status: GatewayStatus) => void;
  applyReady: (
    user: SelfUser,
    guilds: ReadyGuild[],
    readStates: ReadState[],
    privateChannels: APIChannel[],
  ) => void;
  markRead: (channelId: Snowflake, messageId: Snowflake) => void;
  openDMView: (channelId?: Snowflake | null) => void;
  upsertPrivateChannel: (channel: APIChannel) => void;
  setFriends: (list: APIFriendship[]) => void;
  upsertFriend: (friend: APIFriendship) => void;
  removeFriend: (userId: Snowflake) => void;
  setBlocks: (list: APIBlock[]) => void;
  addBlock: (block: APIBlock) => void;
  removeBlock: (userId: Snowflake) => void;
  setServerMuted: (userId: Snowflake, muted: boolean) => void;
  setChannelVolume: (channelId: Snowflake, percent: number) => void;
  setUserVolume: (userId: Snowflake, percent: number) => void;
  setPeerMuted: (userId: Snowflake, muted: boolean) => void;
  setInputSensitivity: (value: number) => void;
  setOutputVolume: (value: number) => void;
  setNoiseSuppression: (value: boolean) => void;
  setInputDeviceId: (value: string | null) => void;
  setOutputDeviceId: (value: string | null) => void;
  setPushToTalk: (value: boolean) => void;
  setPushToTalkKey: (value: string) => void;
  /** Bas-konuş etkinken tuş anlık basılı mı — konuşma göstergesi/mikrofon buna göre. */
  setPushToTalkActive: (active: boolean) => void;
  lockChannelDrag: () => void;
  unlockChannelDrag: () => void;
  setForcedVoiceChannelInfo: (info: { name: string; guildId: Snowflake } | null) => void;
  upsertGuild: (guild: ReadyGuild) => void;
  removeGuild: (guildId: Snowflake) => void;
  setActive: (guildId: Snowflake | null, channelId: Snowflake | null) => void;
  setMessages: (channelId: Snowflake, messages: APIMessage[]) => void;
  prependMessages: (channelId: Snowflake, messages: APIMessage[]) => void;
  addMessage: (message: APIMessage) => void;
  updateMessage: (message: APIMessage) => void;
  removeMessage: (channelId: Snowflake, messageId: Snowflake) => void;
  applyReaction: (input: {
    channelId: Snowflake;
    messageId: Snowflake;
    emoji: string;
    userId: Snowflake;
    added: boolean;
  }) => void;
  setMembers: (guildId: Snowflake, members: APIGuildMember[]) => void;
  setPresence: (userId: Snowflake, status: PresenceStatus) => void;
  setTyping: (channelId: Snowflake, userId: Snowflake) => void;
  upsertChannel: (channel: APIChannel) => void;
  removeChannel: (guildId: Snowflake, channelId: Snowflake) => void;
  upsertRole: (role: APIRole) => void;
  removeRole: (guildId: Snowflake, roleId: Snowflake) => void;
  upsertMember: (member: APIGuildMember) => void;
  removeMember: (guildId: Snowflake, userId: Snowflake) => void;

  /* ---- Ses ---- */
  setVoiceChannel: (channelId: Snowflake | null) => void;
  setVoiceConnecting: (value: boolean) => void;
  /** Bir katılımcıyı ses odasına ekle/güncelle (channelId null → çıkar). */
  applyVoiceState: (channelId: Snowflake | null, participant: VoiceParticipant) => void;
  setSpeaking: (userId: Snowflake, speaking: boolean) => void;
  setSelfMute: (value: boolean) => void;
  setSelfDeaf: (value: boolean) => void;
  setSelfSharing: (value: boolean) => void;
  setVoiceChatOpen: (open: boolean) => void;
  /** Bir kullanıcının ekran akışını ayarla (null → kaldır). */
  setScreenStream: (userId: Snowflake, stream: MediaStream | null) => void;
  /** Ses oturumunu tamamen sıfırla (ayrılırken). */
  resetVoiceSession: () => void;
}

/** Bir sunucu açılırken hangi kanalın seçileceği: en üstteki metin kanalı. */
function firstTextChannelId(channels: readonly APIChannel[]): Snowflake | null {
  return (
    channels
      .filter((channel) => channel.type === ChannelType.GUILD_TEXT)
      .sort((a, b) => a.position - b.position)[0]?.id ?? null
  );
}

/**
 * READY/GUILD_CREATE'teki ses anlık görüntüsünü `voiceStates` haritasına
 * ekler — bağlanmadan ÖNCE zaten sesli olan kullanıcılar sunucuya
 * tıklandığında (bağlanmadan) roster'da görünsün diye (bkz. ReadyGuild
 * yorumu). Var olan haritayı MUTATE ETMEZ, kopyasını döner.
 */
function mergeVoiceSnapshot(
  voiceStates: Map<Snowflake, Map<Snowflake, VoiceParticipant>>,
  snapshot: readonly VoiceStateUpdatePayload[],
): Map<Snowflake, Map<Snowflake, VoiceParticipant>> {
  if (snapshot.length === 0) return voiceStates;
  const next = new Map(voiceStates);
  for (const vs of snapshot) {
    if (!vs.channelId) continue; // sunucu zaten süzüyor, tip yalnızca genel payload şeklini paylaşıyor
    const roster = new Map(next.get(vs.channelId) ?? new Map<Snowflake, VoiceParticipant>());
    roster.set(vs.userId, {
      user: vs.user,
      selfMute: vs.selfMute,
      selfDeaf: vs.selfDeaf,
      selfVideo: vs.selfVideo,
    });
    next.set(vs.channelId, roster);
  }
  return next;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  status: 'connecting',
  guilds: new Map(),
  messages: new Map(),
  members: new Map(),
  presence: new Map(),
  typing: new Map(),
  readStates: new Map(),
  privateChannels: [],
  dmView: false,
  friends: [],
  blocks: [],
  activeGuildId: null,
  activeChannelId: null,
  pendingActiveGuildId: null,

  memberListVisible: localStorage.getItem('tuscord.memberListVisible') !== 'false',
  memberListMode: localStorage.getItem('tuscord.memberListMode') === 'online' ? 'online' : 'all',
  messageSounds: localStorage.getItem('tuscord.messageSounds') !== 'false',
  invisible: localStorage.getItem('tuscord.invisible') === 'true',

  voiceChannelId: null,
  voiceConnecting: false,
  voiceStates: new Map(),
  voiceSpeaking: new Set(),
  selfMute: false,
  selfDeaf: false,
  screenStreams: new Map(),
  selfSharing: false,
  voiceChatOpen: false,
  serverMutedUserIds: new Set(),
  channelVolumes: loadChannelVolumes(),
  userVolumes: loadUserVolumes(),
  mutedPeerIds: loadMutedPeerIds(),
  inputSensitivity: loadInputSensitivity(),
  outputVolume: loadOutputVolume(),
  noiseSuppression: loadNoiseSuppression(),
  inputDeviceId: loadInputDeviceId(),
  outputDeviceId: loadOutputDeviceId(),
  pushToTalk: loadPushToTalk(),
  pushToTalkKey: loadPushToTalkKey(),
  pushToTalkActive: false,
  channelDragLockCount: 0,
  forcedVoiceChannelInfo: null,

  setUser: (user) => set({ user }),

  setMemberListVisible: (visible) => {
    localStorage.setItem('tuscord.memberListVisible', String(visible));
    set({ memberListVisible: visible });
  },

  setMemberListMode: (mode) => {
    localStorage.setItem('tuscord.memberListMode', mode);
    set({ memberListMode: mode });
  },

  setMessageSounds: (enabled) => {
    localStorage.setItem('tuscord.messageSounds', String(enabled));
    set({ messageSounds: enabled });
  },

  setInvisible: (value) => {
    localStorage.setItem('tuscord.invisible', String(value));
    set({ invisible: value });
  },

  bumpUnread: (channelId, mention) =>
    set((state) => {
      const readStates = new Map(state.readStates);
      const current = readStates.get(channelId) ?? {
        lastReadMessageId: null,
        mentionCount: 0,
        unreadCount: 0,
      };
      readStates.set(channelId, {
        ...current,
        unreadCount: current.unreadCount + 1,
        mentionCount: current.mentionCount + (mention ? 1 : 0),
      });
      return { readStates };
    }),

  lockChannelDrag: () =>
    set((state) => ({ channelDragLockCount: state.channelDragLockCount + 1 })),
  unlockChannelDrag: () =>
    set((state) => ({ channelDragLockCount: Math.max(0, state.channelDragLockCount - 1) })),

  setForcedVoiceChannelInfo: (info) => set({ forcedVoiceChannelInfo: info }),

  /**
   * Sunucu zaten geldiyse hemen aç, gelmediyse beklemeye al.
   *
   * İki sıra da mümkün: GUILD_CREATE olayı WebSocket üzerinden, POST cevabı
   * HTTP üzerinden gelir ve genelde olay önce varır. Yalnızca "beklemeye al"
   * deseydik, hızlı gelen olayda sunucu açılmadan kalırdı.
   */
  setPendingActiveGuild: (guildId) =>
    set((state) => {
      if (guildId === null) return { pendingActiveGuildId: null };
      const existing = state.guilds.get(guildId);
      if (!existing) return { pendingActiveGuildId: guildId };
      return {
        pendingActiveGuildId: null,
        activeGuildId: guildId,
        activeChannelId: firstTextChannelId(existing.channels),
      };
    }),
  setStatus: (status) => set({ status }),

  applyReady: (user, readyGuilds, states, privateChannels) =>
    set((state) => {
      const guilds = new Map<Snowflake, GuildState>();
      let voiceStates = state.voiceStates;
      for (const entry of readyGuilds) {
        guilds.set(entry.guild.id, {
          guild: entry.guild,
          channels: entry.channels,
          roles: entry.roles,
          member: entry.member,
          memberCount: entry.memberCount,
          permissions: entry.permissions,
        });
        voiceStates = mergeVoiceSnapshot(voiceStates, entry.voiceStates ?? []);
      }
      const readStates = new Map(
        (states ?? []).map((s) => [
          s.channelId,
          { lastReadMessageId: s.lastReadMessageId, mentionCount: s.mentionCount, unreadCount: s.unreadCount },
        ]),
      );
      return { user, guilds, readStates, privateChannels: privateChannels ?? [], voiceStates };
    }),

  markRead: (channelId, messageId) =>
    set((state) => {
      const readStates = new Map(state.readStates);
      readStates.set(channelId, { lastReadMessageId: messageId, mentionCount: 0, unreadCount: 0 });
      return { readStates };
    }),

  /** DM görünümüne geç. Kanal verilmezse ilk DM açılır. */
  openDMView: (channelId) =>
    set((state) => ({
      dmView: true,
      activeGuildId: null,
      activeChannelId: channelId ?? state.privateChannels[0]?.id ?? null,
    })),

  upsertPrivateChannel: (channel) =>
    set((state) => {
      const exists = state.privateChannels.some((existing) => existing.id === channel.id);
      return {
        privateChannels: exists
          ? state.privateChannels.map((existing) =>
              existing.id === channel.id ? channel : existing,
            )
          : [...state.privateChannels, channel],
      };
    }),

  setFriends: (list) => set({ friends: list }),

  upsertFriend: (friend) =>
    set((state) => {
      const exists = state.friends.some((f) => f.user.id === friend.user.id);
      return {
        friends: exists
          ? state.friends.map((f) => (f.user.id === friend.user.id ? friend : f))
          : [...state.friends, friend],
      };
    }),

  removeFriend: (userId) =>
    set((state) => ({ friends: state.friends.filter((f) => f.user.id !== userId) })),

  setBlocks: (list) => set({ blocks: list }),

  addBlock: (block) =>
    set((state) => ({
      blocks: state.blocks.some((b) => b.user.id === block.user.id)
        ? state.blocks
        : [...state.blocks, block],
    })),

  removeBlock: (userId) =>
    set((state) => ({ blocks: state.blocks.filter((b) => b.user.id !== userId) })),

  setServerMuted: (userId, muted) =>
    set((state) => {
      const serverMutedUserIds = new Set(state.serverMutedUserIds);
      if (muted) serverMutedUserIds.add(userId);
      else serverMutedUserIds.delete(userId);
      return { serverMutedUserIds };
    }),

  setChannelVolume: (channelId, percent) =>
    set((state) => {
      const channelVolumes = new Map(state.channelVolumes);
      channelVolumes.set(channelId, percent);
      saveChannelVolumes(channelVolumes);
      return { channelVolumes };
    }),

  setUserVolume: (userId, percent) =>
    set((state) => {
      const userVolumes = new Map(state.userVolumes);
      userVolumes.set(userId, percent);
      saveUserVolumes(userVolumes);
      return { userVolumes };
    }),

  setPeerMuted: (userId, muted) =>
    set((state) => {
      const mutedPeerIds = new Set(state.mutedPeerIds);
      if (muted) mutedPeerIds.add(userId);
      else mutedPeerIds.delete(userId);
      saveMutedPeerIds(mutedPeerIds);
      return { mutedPeerIds };
    }),

  setInputSensitivity: (value) => {
    saveInputSensitivity(value);
    set({ inputSensitivity: value });
  },
  setOutputVolume: (value) => {
    saveOutputVolume(value);
    set({ outputVolume: value });
  },
  setNoiseSuppression: (value) => {
    saveNoiseSuppression(value);
    set({ noiseSuppression: value });
  },
  setInputDeviceId: (value) => {
    saveInputDeviceId(value);
    set({ inputDeviceId: value });
  },
  setOutputDeviceId: (value) => {
    saveOutputDeviceId(value);
    set({ outputDeviceId: value });
  },
  setPushToTalk: (value) => {
    savePushToTalk(value);
    set({ pushToTalk: value });
  },
  setPushToTalkKey: (value) => {
    savePushToTalkKey(value);
    set({ pushToTalkKey: value });
  },
  setPushToTalkActive: (active) => set({ pushToTalkActive: active }),

  upsertGuild: (entry) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      guilds.set(entry.guild.id, {
        guild: entry.guild,
        channels: entry.channels,
        roles: entry.roles,
        member: entry.member,
        memberCount: entry.memberCount,
        permissions: entry.permissions,
      });
      const voiceStates = mergeVoiceSnapshot(state.voiceStates, entry.voiceStates ?? []);

      // Beklenen sunucu geldi: kendisini ve ilk metin kanalını aç.
      if (state.pendingActiveGuildId === entry.guild.id) {
        return {
          guilds,
          voiceStates,
          pendingActiveGuildId: null,
          activeGuildId: entry.guild.id,
          activeChannelId: firstTextChannelId(entry.channels),
        };
      }

      return { guilds, voiceStates };
    }),

  removeGuild: (guildId) =>
    set((state) => {
      const guilds = new Map(state.guilds);
      guilds.delete(guildId);
      const activeGuildId = state.activeGuildId === guildId ? null : state.activeGuildId;
      return {
        guilds,
        activeGuildId,
        activeChannelId: activeGuildId ? state.activeChannelId : null,
      };
    }),

  // Sunucu seçmek DM görünümünden çıkmak demek.
  setActive: (activeGuildId, activeChannelId) =>
    set({ activeGuildId, activeChannelId, dmView: false }),

  setMessages: (channelId, list) =>
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(channelId, list);
      return { messages };
    }),

  prependMessages: (channelId, older) =>
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(channelId, [...older, ...(state.messages.get(channelId) ?? [])]);
      return { messages };
    }),

  addMessage: (message) =>
    set((state) => {
      const existing = state.messages.get(message.channelId) ?? [];
      // Optimistik gösterimden gelen kopyayı ele: aynı id iki kez girmesin.
      if (existing.some((m) => m.id === message.id)) return {};

      const messages = new Map(state.messages);
      messages.set(message.channelId, [...existing, message]);

      // Kanalın son mesajını da ilerlet: okunmamış rozeti buna bakıyor ve
      // bunun için ayrıca CHANNEL_UPDATE yayınlamak gereksiz trafik olurdu.
      const guilds = new Map(state.guilds);
      if (message.guildId) {
        const guildState = guilds.get(message.guildId);
        if (guildState) {
          guilds.set(message.guildId, {
            ...guildState,
            channels: guildState.channels.map((channel) =>
              channel.id === message.channelId
                ? { ...channel, lastMessageId: message.id }
                : channel,
            ),
          });
        }
      }

      return { messages, guilds };
    }),

  updateMessage: (message) =>
    set((state) => {
      const existing = state.messages.get(message.channelId);
      if (!existing) return {};
      const messages = new Map(state.messages);
      messages.set(
        message.channelId,
        existing.map((m) => (m.id === message.id ? message : m)),
      );
      return { messages };
    }),

  removeMessage: (channelId, messageId) =>
    set((state) => {
      const existing = state.messages.get(channelId);
      if (!existing) return {};
      const messages = new Map(state.messages);
      messages.set(
        channelId,
        existing.filter((m) => m.id !== messageId),
      );
      return { messages };
    }),

  /**
   * Tepki olayı yalnızca "kim, hangi emoji, eklendi mi" bilgisini taşır —
   * mesajın tamamını yeniden çekmemek için sayaç yerel olarak güncellenir.
   */
  applyReaction: ({ channelId, messageId, emoji, userId, added }) =>
    set((state) => {
      const existing = state.messages.get(channelId);
      if (!existing) return {};
      const isMe = state.user?.id === userId;

      const messages = new Map(state.messages);
      messages.set(
        channelId,
        existing.map((message) => {
          if (message.id !== messageId) return message;

          const current = message.reactions.find((reaction) => reaction.emoji === emoji);
          if (added) {
            const reactions = current
              ? message.reactions.map((reaction) =>
                  reaction.emoji === emoji
                    ? { ...reaction, count: reaction.count + 1, me: reaction.me || isMe }
                    : reaction,
                )
              : [...message.reactions, { emoji, count: 1, me: isMe }];
            return { ...message, reactions };
          }

          if (!current) return message;
          const nextCount = current.count - 1;
          return {
            ...message,
            reactions:
              nextCount <= 0
                ? message.reactions.filter((reaction) => reaction.emoji !== emoji)
                : message.reactions.map((reaction) =>
                    reaction.emoji === emoji
                      ? { ...reaction, count: nextCount, me: isMe ? false : reaction.me }
                      : reaction,
                  ),
          };
        }),
      );
      return { messages };
    }),

  setMembers: (guildId, list) =>
    set((state) => {
      const members = new Map(state.members);
      members.set(guildId, list);
      return { members };
    }),

  setPresence: (userId, status) =>
    set((state) => {
      const presence = new Map(state.presence);
      presence.set(userId, status);
      return { presence };
    }),

  setTyping: (channelId, userId) =>
    set((state) => {
      const typing = new Map(state.typing);
      const inChannel = new Map(typing.get(channelId) ?? []);
      inChannel.set(userId, Date.now());
      typing.set(channelId, inChannel);
      return { typing };
    }),

  upsertChannel: (channel) =>
    set((state) => {
      if (!channel.guildId) return {};
      const guildState = state.guilds.get(channel.guildId);
      if (!guildState) return {};
      const guilds = new Map(state.guilds);
      const exists = guildState.channels.some((c) => c.id === channel.id);
      guilds.set(channel.guildId, {
        ...guildState,
        channels: exists
          ? guildState.channels.map((c) => (c.id === channel.id ? channel : c))
          : [...guildState.channels, channel],
      });
      return { guilds };
    }),

  removeChannel: (guildId, channelId) =>
    set((state) => {
      const guildState = state.guilds.get(guildId);
      if (!guildState) return {};
      const guilds = new Map(state.guilds);
      guilds.set(guildId, {
        ...guildState,
        channels: guildState.channels.filter((c) => c.id !== channelId),
      });
      return {
        guilds,
        activeChannelId: state.activeChannelId === channelId ? null : state.activeChannelId,
      };
    }),

  /**
   * Rol değişimi izin hesabını doğrudan etkiler: roller bayat kalırsa
   * arayüz kullanıcının artık sahip olmadığı düğmeleri göstermeye devam eder.
   * Kendi rollerimizi ilgilendiren değişikliklerde temel izinler de yenilenir.
   */
  upsertRole: (role) =>
    set((state) => {
      const guildState = state.guilds.get(role.guildId);
      if (!guildState) return {};
      const exists = guildState.roles.some((existing) => existing.id === role.id);
      const roles = exists
        ? guildState.roles.map((existing) => (existing.id === role.id ? role : existing))
        : [...guildState.roles, role];

      const guilds = new Map(state.guilds);
      guilds.set(role.guildId, {
        ...guildState,
        roles,
        permissions: recomputePermissions(guildState.guild, roles, guildState.member),
      });
      return { guilds };
    }),

  removeRole: (guildId, roleId) =>
    set((state) => {
      const guildState = state.guilds.get(guildId);
      if (!guildState) return {};
      const roles = guildState.roles.filter((role) => role.id !== roleId);
      const member = {
        ...guildState.member,
        roles: guildState.member.roles.filter((id) => id !== roleId),
      };

      const guilds = new Map(state.guilds);
      guilds.set(guildId, {
        ...guildState,
        roles,
        member,
        permissions: recomputePermissions(guildState.guild, roles, member),
      });
      return { guilds };
    }),

  upsertMember: (member) =>
    set((state) => {
      const list = state.members.get(member.guildId) ?? [];
      const exists = list.some((existing) => existing.user.id === member.user.id);
      const members = new Map(state.members);
      members.set(
        member.guildId,
        exists
          ? list.map((existing) => (existing.user.id === member.user.id ? member : existing))
          : [...list, member],
      );

      // Değişen kişi bizsek kendi izinlerimiz de yenilenmeli.
      const guildState = state.guilds.get(member.guildId);
      if (!guildState || member.user.id !== state.user?.id) return { members };

      const guilds = new Map(state.guilds);
      guilds.set(member.guildId, {
        ...guildState,
        member,
        permissions: recomputePermissions(guildState.guild, guildState.roles, member),
      });
      return { members, guilds };
    }),

  removeMember: (guildId, userId) =>
    set((state) => {
      const list = state.members.get(guildId);
      if (!list) return {};
      const members = new Map(state.members);
      members.set(
        guildId,
        list.filter((member) => member.user.id !== userId),
      );
      return { members };
    }),

  /* ---- Ses ---- */

  setVoiceChannel: (channelId) => set({ voiceChannelId: channelId }),
  setVoiceConnecting: (value) => set({ voiceConnecting: value }),

  applyVoiceState: (channelId, participant) =>
    set((state) => {
      const voiceStates = new Map(state.voiceStates);
      // Kişi hangi kanaldaysa oradan kaldır (kanal değiştirmiş olabilir).
      for (const [chId, roster] of voiceStates) {
        if (roster.has(participant.user.id)) {
          const next = new Map(roster);
          next.delete(participant.user.id);
          if (next.size === 0) voiceStates.delete(chId);
          else voiceStates.set(chId, next);
        }
      }
      // channelId null → yalnızca kaldırma (ayrıldı).
      if (channelId) {
        const roster = new Map(voiceStates.get(channelId) ?? new Map<Snowflake, VoiceParticipant>());
        roster.set(participant.user.id, participant);
        voiceStates.set(channelId, roster);
      }
      return { voiceStates };
    }),

  setSpeaking: (userId, speaking) =>
    set((state) => {
      if (state.voiceSpeaking.has(userId) === speaking) return {};
      const voiceSpeaking = new Set(state.voiceSpeaking);
      if (speaking) voiceSpeaking.add(userId);
      else voiceSpeaking.delete(userId);
      return { voiceSpeaking };
    }),

  setSelfMute: (value) => set({ selfMute: value }),
  setSelfDeaf: (value) => set({ selfDeaf: value }),
  setSelfSharing: (value) => set({ selfSharing: value }),
  // Ses kanalının chat'i açılırken üye listesi açıksa kapatılır (dar alanda
  // ikisi sığmıyor) — ama tersi olmaz: chat açıkken üye listesi açılırsa
  // ikisi birlikte kalır (bkz. kullanıcı isteği).
  setVoiceChatOpen: (open) =>
    set((state) => {
      if (open && state.memberListVisible) {
        localStorage.setItem('tuscord.memberListVisible', 'false');
        return { voiceChatOpen: open, memberListVisible: false };
      }
      return { voiceChatOpen: open };
    }),

  setScreenStream: (userId, stream) =>
    set((state) => {
      const screenStreams = new Map(state.screenStreams);
      if (stream) screenStreams.set(userId, stream);
      else screenStreams.delete(userId);
      return { screenStreams };
    }),

  resetVoiceSession: () =>
    set({
      voiceChannelId: null,
      voiceConnecting: false,
      selfMute: false,
      selfDeaf: false,
      selfSharing: false,
      voiceChatOpen: false,
      voiceSpeaking: new Set(),
      screenStreams: new Map(),
      pushToTalkActive: false,
      // Sunucu-taraflı susturma kanal oturumuna bağlı — ayrılınca sıfırlanır
      // (bkz. AppState.serverMutedUserIds yorumu). Kişisel ses tercihleri
      // (channelVolumes/userVolumes/mutedPeerIds) BURADA sıfırlanmaz —
      // localStorage'da kalıcı, oturumlar arası korunmalı.
      serverMutedUserIds: new Set(),
      forcedVoiceChannelInfo: null,
    }),
}));

/**
 * Üyenin sunucu düzeyi izinlerini yeniden hesaplar.
 * Sunucudakiyle aynı saf fonksiyonu kullanır — iki farklı kural olmasın.
 */
function recomputePermissions(
  guild: APIGuild,
  roles: readonly APIRole[],
  member: APIGuildMember,
): string {
  const everyone = roles.find((role) => role.id === guild.id);
  return computeBasePermissions(
    {
      id: guild.id,
      ownerId: guild.ownerId,
      everyoneRole: {
        id: guild.id,
        position: 0,
        permissions: everyone ? BigInt(everyone.permissions) : 0n,
      },
      roles: new Map(
        roles
          .filter((role) => role.id !== guild.id)
          .map((role) => [
            role.id,
            { id: role.id, position: role.position, permissions: BigInt(role.permissions) },
          ]),
      ),
    },
    {
      userId: member.user.id,
      roleIds: member.roles,
      timeoutUntil: member.timeoutUntil ? new Date(member.timeoutUntil) : null,
    },
  ).toString();
}
