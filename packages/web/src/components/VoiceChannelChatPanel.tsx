/**
 * Ses kanalına özel sohbet paneli — Discord'daki gibi, sağdan açılan bir
 * panelde ses kanalının KENDİ metin geçmişi. Global `activeChannelId`/
 * okunmuşluk akışına DOKUNMAZ: kendi mesaj listesini kendi useEffect'iyle
 * çeker (bkz. ChatShell.tsx'teki ana kanal geçmişi yükleme deseni — burada
 * kasıtlı olarak AYNI şey tekrarlanıyor, çünkü bu panel ana kanaldan
 * bağımsız, eşzamanlı açık kalabilmeli).
 *
 * store.messages Map'i zaten channelId'ye göre anahtarlanıyor ve gateway
 * MESSAGE_CREATE olayı hangi kanal aktif olursa olsun bu Map'i güncelliyor
 * (bkz. store/index.ts addMessage) — o yüzden canlı mesajlar için ekstra bir
 * şey yapmaya gerek yok, yalnızca ilk geçmişi burada çekiyoruz.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { APIMessage } from '@tuscord/shared';
import { Permission } from '@tuscord/shared';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import { useStore } from '../store';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

// Modül seviyesinde SABİT referans: Map'te henüz bu kanal için kayıt yoksa
// `?? []` yerine bunu döndürüyoruz. Aksi halde her render'da yeni bir dizi
// oluşur, Zustand'ın Object.is karşılaştırması bunu "değişti" sanır ve
// bileşen (store'daki ALAKASIZ bir alan değişse bile) sürekli yeniden
// render edilir — ses seviyesi ölçümü gibi yüksek frekanslı store
// güncellemeleriyle birleşince React'i "Maximum update depth exceeded"
// hatasına düşürür (bkz. canlı testte yakalanan çökme).
const EMPTY_MESSAGES: APIMessage[] = [];

interface Props {
  channelId: string;
  channelName: string;
  permissions: bigint;
  userNames: Map<string, string>;
  roleNames: Map<string, string>;
  userColors: Map<string, number>;
  onOpenProfile: (user: APIMessage['author']) => void;
  onClose: () => void;
}

export function VoiceChannelChatPanel({
  channelId,
  channelName,
  permissions,
  userNames,
  roleNames,
  userColors,
  onOpenProfile,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const messages = useStore((s) => s.messages.get(channelId) ?? EMPTY_MESSAGES);
  const setMessages = useStore((s) => s.setMessages);
  const prependMessages = useStore((s) => s.prependMessages);
  const currentUserId = useStore((s) => s.user?.id ?? null);
  const [replyTo, setReplyTo] = useState<APIMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<APIMessage[]>(`/channels/${channelId}/messages?limit=50`)
      .then((list) => {
        if (!cancelled) setMessages(channelId, [...list].reverse());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelId, setMessages]);

  /**
   * Panel açıkken okundu işaretle — ChatShell.tsx'teki ana kanal ack
   * effect'iyle AYNI mantık, kasıtlı olarak burada tekrarlanıyor: bu panel
   * ana kanaldan bağımsız açık kalabiliyor, global activeChannelId'ye
   * dokunmuyor (bkz. dosya başı yorumu). Bu effect olmadan ses kanalının
   * sohbeti asla okundu sayılmaz, rozet hep takılı kalır.
   */
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!lastMessageId) return;
    const acknowledge = () => {
      if (document.visibilityState !== 'visible') return;
      const known = useStore.getState().readStates.get(channelId);
      if (known?.lastReadMessageId === lastMessageId && known.mentionCount === 0) return;

      useStore.getState().markRead(channelId, lastMessageId);
      void api.post(`/channels/${channelId}/ack`, { messageId: lastMessageId }).catch(() => undefined);
    };

    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    return () => document.removeEventListener('visibilitychange', acknowledge);
  }, [channelId, lastMessageId]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    const older = await api.get<APIMessage[]>(
      `/channels/${channelId}/messages?limit=50&before=${oldest.id}`,
    );
    if (older.length > 0) prependMessages(channelId, [...older].reverse());
  }

  const canSend = can(permissions, Permission.SEND_MESSAGES);
  const canManageMessages = can(permissions, Permission.MANAGE_MESSAGES);
  const mentionables = useMemo(
    () =>
      Array.from(userNames.entries()).map(([id, displayName]) => ({
        id,
        username: displayName,
        displayName,
        avatarUrl: null,
      })),
    [userNames],
  );

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface-1)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] px-3">
        <span className="truncate text-sm font-medium">
          {t('voice.channelChatTitle', { channel: channelName })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
        >
          <X size={16} />
        </button>
      </div>

      <MessageList
        messages={messages}
        currentUserId={currentUserId}
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
          await api.patch(`/channels/${message.channelId}/messages/${message.id}`, { content });
        }}
        onReply={setReplyTo}
        onOpenProfile={onOpenProfile}
        onToggleReaction={(message, emoji, active) => {
          const path = `/channels/${message.channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
          void (active ? api.delete(path) : api.put(path)).catch(() => undefined);
        }}
        onReport={(message) =>
          useStore.getState().setReportTarget({ targetType: 'message', targetId: message.id })
        }
      />
      <Composer
        channelId={channelId}
        channelName={channelName}
        disabled={!canSend}
        canAttach={can(permissions, Permission.ATTACH_FILES)}
        slowmodeSeconds={0}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        mentionables={mentionables}
      />
    </div>
  );
}
