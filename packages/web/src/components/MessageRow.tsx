/**
 * Tek bir mesaj satırı: içerik, ekler, tepkiler ve hover eylem çubuğu.
 *
 * Eylemler izne göre görünür — düzenleme yalnızca yazarına aittir
 * (MANAGE_MESSAGES başkasının sözünü değiştirme yetkisi vermez, yalnızca
 * silme yetkisi verir; sunucu da aynı kuralı uygular).
 */

import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, Paperclip, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import type { APIMessage } from '@tuscord/shared';
import { MessageContent } from './MessageContent';
import { Avatar } from './Avatar';

/** Hızlı tepki seçenekleri — tam emoji seçici Faz 1.5. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🔥'] as const;

interface Props {
  message: APIMessage;
  /** Aynı yazarın kısa aralıklı ardışık mesajı: başlık tekrar edilmez. */
  grouped: boolean;
  replyTarget: APIMessage | null;
  /** Yanıt referansına tıklanınca vurgulanacak hedef mesaja atla. */
  highlighted?: boolean;
  currentUserId: string | null;
  canDelete: boolean;
  canEdit: boolean;
  userNames: Map<string, string>;
  roleNames: Map<string, string>;
  onDelete: () => void;
  onEdit: (content: string) => Promise<void>;
  onReply: () => void;
  onJumpToReply?: () => void;
  onOpenProfile: () => void;
  onToggleReaction: (emoji: string, active: boolean) => void;
  onReport: () => void;
}

export function MessageRow({
  message,
  grouped,
  replyTarget,
  highlighted,
  currentUserId,
  canDelete,
  canEdit,
  userNames,
  roleNames,
  onOpenProfile,
  onDelete,
  onEdit,
  onReply,
  onJumpToReply,
  onToggleReaction,
  onReport,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [pickerOpen, setPickerOpen] = useState(false);

  const author = message.author.displayName ?? message.author.username;
  const time = new Date(message.createdAt);
  const mentionsMe =
    currentUserId !== null &&
    (message.mentions.includes(currentUserId) || message.mentionEveryone);

  async function commitEdit() {
    const next = draft.trim();
    if (next.length === 0 || next === message.content) {
      setEditing(false);
      setDraft(message.content);
      return;
    }
    await onEdit(next);
    setEditing(false);
  }

  function handleEditKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      setEditing(false);
      setDraft(message.content);
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void commitEdit();
    }
  }

  return (
    <div
      className={`group relative flex gap-3 py-0.5 transition-colors duration-500 ${
        highlighted
          ? 'bg-[var(--color-brand)]/20'
          : mentionsMe
            ? 'border-l-2 border-[var(--color-brand)] bg-[var(--color-brand)]/5'
            : 'hover:bg-[var(--color-surface-1)]'
      } ${grouped ? '' : 'mt-4'}`}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden text-[10px] text-[var(--color-ink-faint)] group-hover:block">
            {time.toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <button type="button" onClick={onOpenProfile} className="rounded-full" title={author}>
            <Avatar name={author} avatarUrl={message.author.avatarUrl} size={40} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {replyTarget && (
          <button
            type="button"
            onClick={onJumpToReply}
            className="mb-0.5 flex max-w-full items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            title={t('message.jumpToReply')}
          >
            <Reply size={12} className="rotate-180 shrink-0" />
            <span className="shrink-0 font-medium">
              {replyTarget.author.displayName ?? replyTarget.author.username}
            </span>
            <span className="truncate opacity-80">{replyTarget.content.slice(0, 120)}</span>
          </button>
        )}

        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="font-medium text-[var(--color-ink)] hover:underline"
            >
              {author}
            </button>
            <span className="text-xs text-[var(--color-ink-faint)]">
              {time.toLocaleString('tr', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
        )}

        {editing ? (
          <div>
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleEditKey}
              rows={Math.min(10, draft.split('\n').length)}
              className="w-full resize-none rounded bg-[var(--color-surface-2)] p-2 text-[var(--color-ink)] outline-none"
            />
            <div className="mt-1 text-xs text-[var(--color-ink-faint)]">{t('message.editHint')}</div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[var(--color-ink)]">
            <MessageContent
              content={message.content}
              userNames={userNames}
              roleNames={roleNames}
              mentionsMe={mentionsMe}
            />
            {message.editedAt && (
              <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
                {t('message.edited')}
              </span>
            )}
          </div>
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {message.attachments.map((attachment) =>
              attachment.previewUrl ? (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block"
                >
                  {/*
                    loading="lazy" kasıtlı olarak yok: liste sanallaştırılmış,
                    DOM'da olan görsel görünür demek. Ayrıca satırlar
                    absolute + transform ile konumlandığı için tarayıcının
                    tembel yükleme görünürlük hesabı güvenilmez.
                  */}
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.filename}
                    className="max-h-80 max-w-full rounded border border-[var(--color-line)] object-contain"
                  />
                </a>
              ) : (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-brand)]"
                >
                  <Paperclip size={14} />
                  <span className="max-w-60 truncate">{attachment.filename}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {formatSize(attachment.size)}
                  </span>
                </a>
              ),
            )}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onToggleReaction(reaction.emoji, reaction.me)}
                className={`rounded px-1.5 py-0.5 text-sm transition ${
                  reaction.me
                    ? 'bg-[var(--color-brand)]/20 ring-1 ring-[var(--color-brand)]'
                    : 'bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover eylem çubuğu */}
      {!editing && (
        <div className="absolute right-2 top-0 hidden items-center gap-0.5 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-0.5 group-hover:flex">
          <div className="relative">
            <Action label={t('message.react')} onClick={() => setPickerOpen((open) => !open)}>
              <SmilePlus size={14} />
            </Action>
            {pickerOpen && (
              <div className="absolute right-0 top-8 z-10 flex gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1 shadow-lg">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onToggleReaction(emoji, false);
                      setPickerOpen(false);
                    }}
                    className="rounded px-1 py-0.5 text-lg hover:bg-[var(--color-surface-3)]"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Action label={t('message.reply')} onClick={onReply}>
            <Reply size={14} />
          </Action>

          {canEdit && (
            <Action
              label={t('message.edit')}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Pencil size={14} />
            </Action>
          )}

          {message.author.id !== currentUserId && (
            <Action label={t('message.report')} onClick={onReport}>
              <Flag size={14} />
            </Action>
          )}

          {canDelete && (
            <Action label={t('message.delete')} danger onClick={onDelete}>
              <Trash2 size={14} />
            </Action>
          )}
        </div>
      )}
    </div>
  );
}

function Action({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1.5 transition hover:bg-[var(--color-surface-3)] ${
        danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'
      }`}
    >
      {children}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
