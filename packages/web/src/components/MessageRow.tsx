/**
 * Tek bir mesaj satırı: içerik, ekler, tepkiler ve hover eylem çubuğu.
 *
 * Eylemler izne göre görünür — düzenleme yalnızca yazarına aittir
 * (MANAGE_MESSAGES başkasının sözünü değiştirme yetkisi vermez, yalnızca
 * silme yetkisi verir; sunucu da aynı kuralı uygular).
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, Paperclip, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import type { APIMessage } from '@tuscord/shared';
import { useStore } from '../store';
import { MessageContent } from './MessageContent';
import { Avatar } from './Avatar';
import { ImageLightbox } from './ImageLightbox';
import { LinkEmbeds } from './LinkEmbeds';

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
  /** Yazarın en yüksek konumlu RENKLİ rolünün rengi — yoksa varsayılan renk kullanılır. */
  authorColor?: number;
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
  authorColor,
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
  /** Listenin en altındaki mesajlarda tepki çubuğu ekran dışına taşmasın diye
   * yeterli yer yoksa yukarı açılır (bkz. kullanıcı raporu). */
  const [pickerOpensUpward, setPickerOpensUpward] = useState(false);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);
  const isBlocked = useStore((s) => s.blocks.some((b) => b.user.id === message.author.id));
  const [revealed, setRevealed] = useState(false);
  const [lightboxAttachment, setLightboxAttachment] = useState<{ url: string; filename: string } | null>(
    null,
  );

  // Açılınca, altta yeterli yer olup olmadığını ölç — yoksa yukarı açılsın.
  // ÖNEMLİ: pencere yüksekliği DEĞİL, mesaj listesinin kendi kaydırılabilir
  // kutusunun alt sınırı esas alınır — altında Composer (yazma kutusu) var,
  // o da yer kaplıyor; pencereye göre "sığıyor" görünse bile Composer'ın
  // ARKASINDA kalabiliyordu (bkz. kullanıcı raporu: son 1-2 mesajda).
  useLayoutEffect(() => {
    if (!pickerOpen || !pickerAnchorRef.current) return;
    const rect = pickerAnchorRef.current.getBoundingClientRect();
    const scrollContainer = pickerAnchorRef.current.closest('.overflow-y-auto');
    const bottomLimit = scrollContainer ? scrollContainer.getBoundingClientRect().bottom : window.innerHeight;
    const PICKER_HEIGHT_ESTIMATE = 48; // px — dolgu + emoji satırı, kabaca.
    setPickerOpensUpward(rect.bottom + PICKER_HEIGHT_ESTIMATE > bottomLimit);
  }, [pickerOpen]);

  const author = message.author.displayName ?? message.author.username;
  const time = new Date(message.createdAt);
  // İsim VE saat, yazarın en yüksek konumlu renkli rolüyle aynı renkte —
  // rengi yoksa (authorColor undefined) varsayılan Tailwind sınıfları kalır.
  const roleColorStyle =
    authorColor !== undefined ? { color: `#${authorColor.toString(16).padStart(6, '0')}` } : undefined;
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

  // Engellenen kullanıcının mesajı — içerik daraltılmış, isteyen açabilir.
  // Tamamen gizlemek yerine bunu tercih ettik: mesaj listesinde açıklanamayan
  // boşluklar (yanıt zinciri kopması, "kaç mesaj var" tutarsızlığı) yaratmaz.
  if (isBlocked && !revealed) {
    return (
      <div className={`flex items-center gap-2 py-1 text-sm text-[var(--color-ink-faint)] ${grouped ? '' : 'mt-4'}`}>
        <div className="w-10 shrink-0" />
        <span className="italic">{t('message.blockedAuthor')}</span>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="text-xs text-[var(--color-ink-muted)] underline hover:text-[var(--color-ink)]"
        >
          {t('message.showAnyway')}
        </button>
      </div>
    );
  }

  return (
    <>
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
          <span
            className={`hidden text-[10px] group-hover:block ${roleColorStyle ? '' : 'text-[var(--color-ink-faint)]'}`}
            style={roleColorStyle}
          >
            {time.toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : (
          <button type="button" onClick={onOpenProfile} className="rounded-full" title={author}>
            <Avatar name={author} avatarUrl={message.author.avatarUrl} size={40} />
          </button>
        )}
      </div>

      <div
        className="min-w-0 flex-1 cursor-pointer"
        title={t('message.doubleClickReply')}
        onDoubleClick={(event) => {
          // Düzenleme kutusunda çift tık kelime seçmek için — yanıta geçmesin.
          if (editing) return;
          // Kendi tıklama anlamı olan öğeler (profil, tepki, ek dosya,
          // "mesaja git", tam ekran önizleme) bu davranışı devralmasın —
          // yalnızca boş alan ve düz metin çift tıkla yanıtlasın.
          if (event.target instanceof HTMLElement && event.target.closest('button, a, textarea')) return;
          // Çift tık kelime seçer; yanıt kutusuna odaklanınca görünmez
          // kalır ama yine de temizleyelim ki ekranda asılı kalmasın.
          window.getSelection()?.removeAllRanges();
          onReply();
        }}
      >
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
              className={`font-medium hover:underline ${roleColorStyle ? '' : 'text-[var(--color-ink)]'}`}
              style={roleColorStyle}
            >
              {author}
            </button>
            <span
              className={`text-xs ${roleColorStyle ? '' : 'text-[var(--color-ink-faint)]'}`}
              style={roleColorStyle}
            >
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

        {!editing && <LinkEmbeds content={message.content} />}

        {message.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {message.attachments.map((attachment) =>
              attachment.previewUrl ? (
                // `<a target="_blank">` yerine düğme: eskiden dosya URL'sini
                // doğrudan açıyordu, tarayıcı bunu çoğu zaman önizleme yerine
                // ANINDA İNDİRME sayıyordu (bkz. kullanıcı raporu). Artık
                // tıklama yalnızca tam ekran önizlemeyi açar — indirme orada
                // ayrı, açık bir düğme (bkz. ImageLightbox.tsx).
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setLightboxAttachment({ url: attachment.url, filename: attachment.filename })}
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
                </button>
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
          <div className="relative" ref={pickerAnchorRef}>
            <Action label={t('message.react')} onClick={() => setPickerOpen((open) => !open)}>
              <SmilePlus size={14} />
            </Action>
            {pickerOpen && (
              <div
                className={`absolute right-0 z-10 flex gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1 shadow-lg ${
                  pickerOpensUpward ? 'bottom-8' : 'top-8'
                }`}
              >
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
    {lightboxAttachment && (
      <ImageLightbox
        url={lightboxAttachment.url}
        filename={lightboxAttachment.filename}
        onClose={() => setLightboxAttachment(null)}
      />
    )}
    </>
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
