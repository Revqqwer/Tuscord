/**
 * Mesaj listesi — sanallaştırılmış (spec Bölüm 9: 10.000 mesajı DOM'a
 * basmak tarayıcıyı kilitler).
 *
 * Mesaj gruplama: aynı yazarın 5 dakika içindeki ardışık mesajları tek
 * blokta gösterilir; avatar ve isim yalnızca ilk mesajda.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { APIMessage } from '@tuscord/shared';
import { MessageRow } from './MessageRow';

interface Props {
  messages: APIMessage[];
  currentUserId: string | null;
  canManageMessages: boolean;
  userNames: Map<string, string>;
  roleNames: Map<string, string>;
  /** userId → en yüksek konumlu RENKLİ rolünün rengi (yoksa haritada kayıt yok). */
  userColors: Map<string, number>;
  onDelete: (message: APIMessage) => void;
  onEdit: (message: APIMessage, content: string) => Promise<void>;
  onReply: (message: APIMessage) => void;
  onOpenProfile: (user: APIMessage['author']) => void;
  onToggleReaction: (message: APIMessage, emoji: string, active: boolean) => void;
  onReport: (message: APIMessage) => void;
  onLoadOlder: () => void;
  /** Aramadan gelen "mesaja git": bu id yüklüyse ortala + vurgula. */
  pendingJumpId?: string | null;
  onJumpHandled?: () => void;
}

/** Aynı yazarın 5 dakika içindeki mesajları gruplanır. */
const GROUP_WINDOW_MS = 5 * 60_000;

export function MessageList({
  messages,
  currentUserId,
  canManageMessages,
  userNames,
  roleNames,
  userColors,
  onDelete,
  onEdit,
  onReply,
  onOpenProfile,
  onToggleReaction,
  onReport,
  onLoadOlder,
  pendingJumpId,
  onJumpHandled,
}: Props) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Yanıtlanan mesajı satırda göstermek için hızlı arama tablosu.
  const byId = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    // Tahmini yükseklik; ölçüm measureElement ile gerçek değere düzeltilir.
    estimateSize: () => 44,
    overscan: 12,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  /**
   * Bir mesaja atla: yüklüyse ortala ve kısa süre vurgula. Yüklü değilse
   * (uzak geçmiş) sessizce vazgeç — çevresini yükleme Faz sonrası.
   */
  function jumpTo(messageId: string) {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return false;
    stickToBottom.current = false;
    virtualizer.scrollToIndex(index, { align: 'center' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 1600);
    return true;
  }

  // Aramadan gelen "mesaja git" isteği.
  useEffect(() => {
    if (!pendingJumpId) return;
    jumpTo(pendingJumpId);
    onJumpHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJumpId]);

  // Yeni mesaj geldiğinde yalnızca kullanıcı zaten en alttaysa kaydır —
  // geçmişi okuyan birini aşağı zıplatmak en can sıkıcı hatalardan biri.
  useEffect(() => {
    if (stickToBottom.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [messages.length, virtualizer]);

  function handleScroll() {
    const element = parentRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distanceFromBottom < 80;
    if (element.scrollTop < 200) onLoadOlder();
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--color-ink-faint)]">
        {t('message.empty')}
      </div>
    );
  }

  return (
    <div ref={parentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          if (!message) return null;
          const previous = messages[virtualRow.index - 1];
          const grouped =
            previous !== undefined &&
            previous.author.id === message.author.id &&
            message.replyToId === null &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              GROUP_WINDOW_MS;

          const isAuthor = message.author.id === currentUserId;

          return (
            <div
              key={message.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MessageRow
                message={message}
                grouped={grouped}
                replyTarget={message.replyToId ? (byId.get(message.replyToId) ?? null) : null}
                highlighted={message.id === highlightId}
                currentUserId={currentUserId}
                canDelete={canManageMessages || isAuthor}
                canEdit={isAuthor}
                userNames={userNames}
                roleNames={roleNames}
                authorColor={userColors.get(message.author.id)}
                onDelete={() => onDelete(message)}
                onEdit={(content) => onEdit(message, content)}
                onReply={() => onReply(message)}
                onJumpToReply={() => message.replyToId && jumpTo(message.replyToId)}
                onOpenProfile={() => onOpenProfile(message.author)}
                onToggleReaction={(emoji, active) => onToggleReaction(message, emoji, active)}
                onReport={() => onReport(message)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
