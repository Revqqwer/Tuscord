/**
 * Gateway olaylarını uygulama durumuna bağlar.
 * Tek yer: olay yönlendirmesi dağılırsa hangi olayın neyi güncellediğini
 * takip etmek imkânsızlaşır.
 */

import { useEffect } from 'react';
import {
  GatewayEvent,
  type APIChannel,
  type APIFriendship,
  type APIGuildMember,
  type APIMessage,
  type APIRole,
  type ReadyPayload,
  type VoiceSignalPayload,
  type VoiceStateUpdatePayload,
} from '@tuscord/shared';
import { gateway } from '../lib/gateway';
import { voice } from '../lib/voice';
import { useStore } from '../store';

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
          // Roster (tüm sunucudaki ses odaları) + kendi kanalımdaki eş yönetimi.
          state.applyVoiceState(data.channelId, {
            user: data.user,
            selfMute: data.selfMute,
            selfDeaf: data.selfDeaf,
          });
          voice.onVoiceState(data);
          break;
        }
        case GatewayEvent.VOICE_SIGNAL: {
          void voice.onSignal(payload as VoiceSignalPayload);
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
