/**
 * Gateway olaylarını uygulama durumuna bağlar.
 * Tek yer: olay yönlendirmesi dağılırsa hangi olayın neyi güncellediğini
 * takip etmek imkânsızlaşır.
 */

import { useEffect } from 'react';
import i18n from 'i18next';
import {
  GatewayEvent,
  type APIChannel,
  type APIFriendship,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type ReadyPayload,
  type VoiceForceDisconnectPayload,
  type VoiceForceMovePayload,
  type VoiceForceMutePayload,
  type VoiceStateUpdatePayload,
} from '@tuscord/shared';
import { gateway } from '../lib/gateway';
import { voice } from '../lib/voice';
import { useStore } from '../store';
import { chimesSuppressed, playVoiceChime } from '../lib/voiceChime';
import { playMessageChime } from '../lib/messageChime';

/** Bu üye sayısını aşan sunucularda mesaj sesi otomatik kapanır (bahsetmeler hariç). */
const LARGE_GUILD_SOUND_THRESHOLD = 50;

/**
 * Bahsedildiğinde ve sekme odakta değilken tarayıcı bildirimi göster.
 *
 * Odaktaysa göstermeyiz — kullanıcı zaten ekranda, kırmızı rozet yeterli.
 * İzin verilmemişse sessizce atlanır (uygulama içi rozet her durumda çalışır).
 */
function maybeNotify(message: APIMessage, myId: string | null): void {
  if (!myId || message.author.id === myId) return;
  const mentionsMe = message.mentions.includes(myId) || message.mentionEveryone;
  if (!mentionsMe) return;
  if (document.visibilityState === 'visible') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const name = message.author.displayName ?? message.author.username;
  try {
    new Notification(`${name} seni etiketledi`, {
      body: message.content.slice(0, 120) || 'Yeni bir mesaj',
      icon: '/icon.svg',
      tag: message.channelId, // aynı kanaldan üst üste bildirim yığılmasın
    });
  } catch {
    // Bazı tarayıcılar Notification kurucusunu kısıtlar; sessizce geç.
  }
}

/**
 * Kendi ses kanalımdaki BAŞKALARI için katılma/ayrılma sesi.
 *
 * Kendi katılma/ayrılma sesim `voice.ts` içinde doğrudan çalınıyor (ağ
 * round-trip'ine bağlı olmadan, senkron); bu yalnızca "orada bulunanlara
 * duyuracak" kısmı — biri katılınca/ayrılınca kanaldakiler duysun.
 *
 * `applyVoiceState` roster'ı mutasyona uğratmadan ÖNCE çağrılmalı: "önceden
 * orada mıydı" karşılaştırması eski durumu gerektiriyor.
 */
function maybeChimeForPeer(data: VoiceStateUpdatePayload): void {
  const store = useStore.getState();
  if (data.user.id === store.user?.id) return; // kendi olayım — zaten çalındı
  const myChannel = store.voiceChannelId;
  if (!myChannel || store.selfDeaf || chimesSuppressed()) return;

  const wasHere = store.voiceStates.get(myChannel)?.has(data.user.id) ?? false;
  const isHereNow = data.channelId === myChannel;
  if (!wasHere && isHereNow) playVoiceChime('join');
  else if (wasHere && !isHereNow) playVoiceChime('leave');
}

/**
 * Bir kanal şu an okunuyor mu (rozet artırma/mesaj sesi buna göre atlanır).
 *
 * Ses kanalının kendi sohbeti ÖZEL: yalnızca yan panel (voiceChatOpen)
 * açıkken okunuyor sayılır — sidebar'da sadece SEÇİLİ olması yetmez (bkz.
 * ChatShell.tsx'teki aynı ayrım, ack effect'i). Diğer her kanal (metin/DM)
 * için ana panelde açık olması yeterli.
 */
function isChannelBeingViewed(channelId: string, state: ReturnType<typeof useStore.getState>): boolean {
  if (document.visibilityState !== 'visible') return false;
  if (channelId === state.voiceChannelId) return state.voiceChatOpen;
  return channelId === state.activeChannelId;
}

/**
 * Yeni mesaj/bahsetme sesi — kullanıcı ayarından kapatılabilir (bkz.
 * UserSettings.tsx), kalabalık sunucularda bahsetme DIŞINDA otomatik
 * susturulur (bkz. LARGE_GUILD_SOUND_THRESHOLD) — yoğun bir sunucuda her
 * mesajda ses çalması can sıkıcı olurdu, ama biri seni etiketlediğinde
 * yine de duymalısın.
 */
function maybeChimeForMessage(message: APIMessage, mentionsMe: boolean): void {
  const store = useStore.getState();
  if (!store.messageSounds) return;
  if (message.guildId && !mentionsMe) {
    const memberCount = store.guilds.get(message.guildId)?.memberCount ?? 0;
    if (memberCount > LARGE_GUILD_SOUND_THRESHOLD) return;
  }
  playMessageChime(mentionsMe ? 'mention' : 'message');
}

export function useGateway(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const store = useStore.getState();

    const offStatus = gateway.onStatus((status) => {
      useStore.getState().setStatus(status);
      // Kopup döndüysek ve ses kanalındaysak eşleri yeniden kur.
      if (status === 'ready' && voice.currentChannel) voice.rejoinAfterReconnect();
    });

    const off = gateway.on((event, payload) => {
      const state = useStore.getState();
      switch (event) {
        case GatewayEvent.READY: {
          const ready = payload as ReadyPayload;
          state.applyReady(
            ready.user,
            ready.guilds,
            ready.readStates ?? [],
            ready.privateChannels ?? [],
          );
          break;
        }
        case GatewayEvent.MESSAGE_CREATE: {
          const message = payload as APIMessage;
          state.addMessage(message);
          maybeNotify(message, state.user?.id ?? null);

          const myId = state.user?.id ?? null;
          if (myId && message.author.id !== myId) {
            const mentionsMe = message.mentions.includes(myId) || message.mentionEveryone;
            if (!isChannelBeingViewed(message.channelId, state)) {
              state.bumpUnread(message.channelId, mentionsMe);
            }
            maybeChimeForMessage(message, mentionsMe);
          }
          break;
        }
        case GatewayEvent.MESSAGE_UPDATE:
          state.updateMessage(payload as APIMessage);
          break;
        case GatewayEvent.MESSAGE_DELETE: {
          const data = payload as { id: string; channelId: string };
          state.removeMessage(data.channelId, data.id);
          break;
        }
        case GatewayEvent.MESSAGE_BULK_DELETE: {
          const data = payload as { ids: string[]; channelId: string };
          for (const id of data.ids) state.removeMessage(data.channelId, id);
          break;
        }
        case GatewayEvent.MESSAGE_REACTION_ADD:
        case GatewayEvent.MESSAGE_REACTION_REMOVE: {
          const data = payload as {
            channelId: string;
            messageId: string;
            emoji: string;
            userId: string;
          };
          state.applyReaction({
            channelId: data.channelId,
            messageId: data.messageId,
            emoji: data.emoji,
            userId: data.userId,
            added: event === GatewayEvent.MESSAGE_REACTION_ADD,
          });
          break;
        }
        case GatewayEvent.TYPING_START: {
          const data = payload as { channelId: string; userId: string };
          if (data.userId !== state.user?.id) state.setTyping(data.channelId, data.userId);
          break;
        }
        case GatewayEvent.PRESENCE_UPDATE: {
          const data = payload as { userId: string; status: never };
          state.setPresence(data.userId, data.status);
          break;
        }
        case GatewayEvent.VOICE_STATE_UPDATE: {
          const data = payload as VoiceStateUpdatePayload;
          maybeChimeForPeer(data); // roster mutasyona uğramadan ÖNCE — eski durumu kıyaslıyor
          // Roster (tüm sunucudaki ses odaları) + kendi kanalımdaki eş yönetimi.
          state.applyVoiceState(data.channelId, {
            user: data.user,
            selfMute: data.selfMute,
            selfDeaf: data.selfDeaf,
            selfVideo: data.selfVideo,
          });
          // Eş bağlantı yönetimi artık burada YOK — LiveKit kendi odasını
          // kendi bağlantısı üzerinden yönetiyor (bkz. voice.ts dosya başı
          // yorumu). Bu olay yalnızca roster (yukarısı) için kullanılıyor.
          break;
        }
        case GatewayEvent.VOICE_FORCE_MUTE: {
          const data = payload as VoiceForceMutePayload;
          state.setServerMuted(data.userId, data.muted);
          // Bana aitse mikrofonu gerçekten kapat/kilidi kaldır (bkz. voice.ts).
          if (data.userId === state.user?.id) voice.applyServerMute(data.muted);
          break;
        }
        case GatewayEvent.VOICE_FORCE_MOVE: {
          // Bu olay yalnızca hedef kullanıcıya gider (targetUserIds) — her
          // zaman bana ait, yine de garanti olsun diye kontrol ediyoruz.
          const data = payload as VoiceForceMovePayload;
          if (data.userId === state.user?.id) {
            voice.applyServerMove(data.channelId, data.channelName, data.guildId);
          }
          break;
        }
        case GatewayEvent.VOICE_FORCE_DISCONNECT: {
          const data = payload as VoiceForceDisconnectPayload;
          if (data.userId === state.user?.id) voice.applyServerDisconnect();
          break;
        }
        case GatewayEvent.CHANNEL_CREATE:
        case GatewayEvent.CHANNEL_UPDATE: {
          const channel = payload as APIChannel;
          // guildId yoksa DM: sunucu kanal listesine değil, DM listesine gider.
          if (channel.guildId) state.upsertChannel(channel);
          else state.upsertPrivateChannel(channel);
          break;
        }
        case GatewayEvent.CHANNEL_DELETE: {
          const data = payload as { id: string; guildId: string | null };
          if (data.guildId) state.removeChannel(data.guildId, data.id);
          break;
        }
        case GatewayEvent.GUILD_CREATE:
          state.upsertGuild(payload as never);
          break;
        case GatewayEvent.GUILD_ROLE_CREATE:
        case GatewayEvent.GUILD_ROLE_UPDATE:
          state.upsertRole(payload as APIRole);
          break;
        case GatewayEvent.GUILD_ROLE_DELETE: {
          const data = payload as { guildId: string; roleId: string };
          state.removeRole(data.guildId, data.roleId);
          break;
        }
        case GatewayEvent.GUILD_MEMBER_ADD:
        case GatewayEvent.GUILD_MEMBER_UPDATE:
          state.upsertMember(payload as APIGuildMember);
          break;
        case GatewayEvent.GUILD_MEMBER_REMOVE: {
          const data = payload as { guildId: string; user: { id: string } };
          state.removeMember(data.guildId, data.user.id);
          break;
        }
        case GatewayEvent.FRIEND_UPSERT:
          state.upsertFriend(payload as APIFriendship);
          break;
        case GatewayEvent.FRIEND_REMOVE: {
          const data = payload as { userId: string };
          state.removeFriend(data.userId);
          break;
        }
        case GatewayEvent.GUILD_DELETE: {
          const data = payload as { id: string };
          state.removeGuild(data.id);
          break;
        }
        case GatewayEvent.SESSION_INVALIDATED: {
          // Başka bir yerden (tarayıcı/masaüstü) giriş yapıldı — sunucu zaten
          // bu oturumu sildi, burada yalnızca yerel durumu temizleyip
          // kullanıcıyı giriş ekranına döndürüyoruz.
          alert(i18n.t('auth.sessionInvalidated'));
          state.setUser(null);
          break;
        }
        case GatewayEvent.FORCE_LOGOUT: {
          // Bir yönetici hesabı yasakladı/sildi — sunucu zaten oturumu
          // düşürdü (bkz. auth/session.ts forceLogoutUser); sayfayı
          // yenileyene kadar bağlı kalıp mesaj yazmaya devam etmesin diye
          // ANINDA çıkış yapıyoruz (bkz. kullanıcı raporu).
          const data = payload as { reason?: string };
          alert(
            data.reason === 'account_deleted'
              ? i18n.t('auth.accountDeleted')
              : i18n.t('auth.accountBanned'),
          );
          state.setUser(null);
          break;
        }
        default:
          break;
      }
    });

    gateway.connect();
    store.setStatus('connecting');

    return () => {
      off();
      offStatus();
      gateway.disconnect();
    };
  }, [enabled]);
}
