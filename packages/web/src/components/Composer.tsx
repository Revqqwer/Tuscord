/**
 * Mesaj yazma alanı: metin, dosya ekleme, sürükle-bırak, yazıyor göstergesi.
 */

import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { Limits, type APIAttachment, type APIMessage } from '@tuscord/shared';
import { ApiError, api } from '../lib/api';
import { Avatar } from './Avatar';

/** @ ile etiketlenebilir kişi (kanaldaki üyeler). */
export interface Mentionable {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Props {
  channelId: string;
  channelName: string;
  disabled: boolean;
  canAttach: boolean;
  slowmodeSeconds: number;
  replyTo: APIMessage | null;
  onCancelReply: () => void;
  /** @ ile etiketlenebilecek kişiler (sunucu kanalında üyeler; DM'de boş). */
  mentionables: Mentionable[];
}

interface PendingUpload {
  /** Yükleme tamamlanana kadar geçici kimlik. */
  localId: string;
  filename: string;
  attachment: APIAttachment | null;
  error: string | null;
}

export function Composer({
  channelId,
  channelName,
  disabled,
  canAttach,
  slowmodeSeconds,
  replyTo,
  onCancelReply,
  mentionables,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const lastTyping = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  /** @ autocomplete: aktif sorgu ve seçili öğe; kapalıysa query null. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /**
   * Seçilen bahsetmeler: metindeki `@kullanıcıadı` → id eşlemesi. Gönderirken
   * sunucunun beklediği `<@id>` biçimine çevrilir.
   */
  const picked = useRef<Array<{ label: string; id: string }>>([]);

  const mentionMatches =
    mentionQuery === null
      ? []
      : mentionables
          .filter((m) => {
            const q = mentionQuery.toLocaleLowerCase('tr');
            return (
              m.username.toLocaleLowerCase('tr').includes(q) ||
              (m.displayName ?? '').toLocaleLowerCase('tr').includes(q)
            );
          })
          .slice(0, 8);

  const ready = uploads.filter((u) => u.attachment !== null);
  const busy = uploads.some((u) => u.attachment === null && u.error === null);

  async function upload(files: FileList | File[]) {
    const list = [...files].slice(0, Limits.ATTACHMENTS_PER_MESSAGE - uploads.length);

    for (const file of list) {
      const localId = `${Date.now()}-${file.name}-${Math.random()}`;
      setUploads((current) => [
        ...current,
        { localId, filename: file.name, attachment: null, error: null },
      ]);

      const form = new FormData();
      form.append('file', file);

      try {
        // fetch doğrudan: api yardımcısı JSON gövdesi varsayıyor,
        // FormData'da Content-Type sınırını tarayıcı kendisi koymalı.
        const response = await fetch(`/api/v1/channels/${channelId}/attachments`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        const data = (await response.json()) as APIAttachment | { code: string; error: string };

        if (!response.ok) {
          const code = (data as { code: string }).code;
          setUploads((current) =>
            current.map((u) =>
              u.localId === localId ? { ...u, error: uploadErrorText(code, t) } : u,
            ),
          );
          continue;
        }

        setUploads((current) =>
          current.map((u) =>
            u.localId === localId ? { ...u, attachment: data as APIAttachment } : u,
          ),
        );
      } catch {
        setUploads((current) =>
          current.map((u) => (u.localId === localId ? { ...u, error: t('common.error') } : u)),
        );
      }
    }
  }

  function removeUpload(localId: string) {
    const target = uploads.find((u) => u.localId === localId);
    setUploads((current) => current.filter((u) => u.localId !== localId));
    // Sunucudaki iliştirilmemiş eki de sil; yoksa çöp olarak kalır.
    if (target?.attachment) {
      void api.delete(`/attachments/${target.attachment.id}`).catch(() => undefined);
    }
  }

  async function send() {
    const content = value.trim();
    if (!content && ready.length === 0) return;
    if (busy) return;

    // Seçilen bahsetmeleri sunucu biçimine çevir: `@ali` → `<@123>`.
    // Kelime sınırıyla eşle ki `@ali` başka bir `@alice`yi bozmasın.
    let outgoing = content;
    for (const mention of picked.current) {
      const pattern = new RegExp(escapeRegExp(mention.label) + '(?=\\s|$|[^\\w])', 'u');
      outgoing = outgoing.replace(pattern, `<@${mention.id}>`);
    }

    setValue('');
    setUploads([]);
    setError(null);
    onCancelReply();
    picked.current = [];
    setMentionQuery(null);

    try {
      await api.post(`/channels/${channelId}/messages`, {
        content: outgoing,
        attachmentIds: ready.map((u) => u.attachment!.id),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
    } catch (caught) {
      // Gönderim başarısızsa yazdığını geri ver — kaybolmasın.
      setValue(content);
      setUploads(ready);
      const code = caught instanceof ApiError ? caught.code : 'unknown';
      setError(
        code === 'rate_limited'
          ? t('message.tooFast')
          : code === 'word_filter'
            ? t('message.wordFilter')
            : t('common.error'),
      );
    }
  }

  function handleTyping() {
    const now = Date.now();
    // Sunucu TYPING'i hız sınırına tabi tutuyor; 4 saniyede bir yeterli.
    if (now - lastTyping.current < 4000) return;
    lastTyping.current = now;
    void api.post(`/channels/${channelId}/typing`).catch(() => undefined);
  }

  /** İmleçten hemen önce bir `@sorgu` var mı? Varsa autocomplete'i aç. */
  function detectMention(text: string, caret: number) {
    if (mentionables.length === 0) return;
    const before = text.slice(0, caret);
    // @ + harf/rakam, öncesinde boşluk ya da satır başı.
    const match = /(?:^|\s)@([\w.çğıöşüÇĞİÖŞÜ]*)$/u.exec(before);
    if (match) {
      setMentionQuery(match[1] ?? '');
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  /** Seçilen kişiyi metne yerleştir: `@sorgu` → `@kullanıcıadı `. */
  function pickMention(person: Mentionable) {
    const el = textarea.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const label = `@${person.username}`;

    const replacedBefore = before.replace(/(?:^|\s)@[\w.çğıöşüÇĞİÖŞÜ]*$/u, (m) =>
      m.startsWith('@') ? `${label} ` : `${m[0]}${label} `,
    );
    const next = replacedBefore + after;
    setValue(next);
    if (!picked.current.some((p) => p.id === person.id && p.label === label)) {
      picked.current.push({ label, id: person.id });
    }
    setMentionQuery(null);
    // İmleci eklenen etiketten sonraya taşı.
    requestAnimationFrame(() => {
      el.focus();
      const pos = replacedBefore.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!canAttach || disabled) return;
    if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  }

  return (
    <div
      className="shrink-0 p-4"
      onDragOver={(event) => {
        event.preventDefault();
        if (canAttach && !disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {error && <p className="mb-1 text-xs text-[var(--color-danger)]">{error}</p>}

      {replyTo && (
        <div className="mb-1 flex items-center gap-2 rounded-t bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]">
          <span>
            {t('message.replyingTo', {
              name: replyTo.author.displayName ?? replyTo.author.username,
            })}
          </span>
          <span className="truncate opacity-70">{replyTo.content.slice(0, 80)}</span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t('message.cancelReply')}
            className="ml-auto text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {uploads.map((upload_) => (
            <div
              key={upload_.localId}
              className="flex items-center gap-2 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-sm"
            >
              {upload_.attachment?.previewUrl && (
                <img
                  src={upload_.attachment.previewUrl}
                  alt=""
                  className="h-8 w-8 rounded object-cover"
                />
              )}
              <span className="max-w-40 truncate">{upload_.filename}</span>
              {upload_.error ? (
                <span className="text-xs text-[var(--color-danger)]">{upload_.error}</span>
              ) : !upload_.attachment ? (
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {t('common.loading')}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removeUpload(upload_.localId)}
                aria-label={t('common.delete')}
                className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* @ etiketleme önerileri — yazma alanının üstünde açılır. */}
      {mentionMatches.length > 0 && (
        <div className="mb-1 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-lg">
          <div className="border-b border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            @ {t('friends.title')}
          </div>
          {mentionMatches.map((person, index) => (
            <button
              key={person.id}
              type="button"
              onMouseDown={(event) => {
                // mousedown: textarea focus'u kaybolmadan seçim yapılsın.
                event.preventDefault();
                pickMention(person);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                index === mentionIndex ? 'bg-[var(--color-surface-3)]' : 'hover:bg-[var(--color-surface-3)]'
              }`}
            >
              <Avatar name={person.displayName ?? person.username} avatarUrl={person.avatarUrl} size={22} />
              <span className="font-medium">{person.displayName ?? person.username}</span>
              <span className="text-xs text-[var(--color-ink-faint)]">@{person.username}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-lg bg-[var(--color-surface-2)] px-4 py-3 ${
          dragging ? 'ring-2 ring-[var(--color-brand)]' : ''
        }`}
      >
        {canAttach && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={disabled || uploads.length >= Limits.ATTACHMENTS_PER_MESSAGE}
              aria-label={t('message.attach')}
              title={t('message.attach')}
              className="pb-0.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              <Paperclip size={20} />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void upload(event.target.files);
                // Aynı dosyayı tekrar seçebilmek için değeri sıfırla.
                event.target.value = '';
              }}
            />
          </>
        )}

        <textarea
          ref={textarea}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            detectMention(event.target.value, event.target.selectionStart);
            handleTyping();
          }}
          onKeyUp={(event) => {
            // Ok tuşlarıyla imleç gezerken de @ bağlamını güncelle.
            const el = event.currentTarget;
            detectMention(el.value, el.selectionStart);
          }}
          onKeyDown={(event) => {
            // Autocomplete açıkken ok/enter/tab öneriyi yönetir.
            if (mentionMatches.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionMatches.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                pickMention(mentionMatches[mentionIndex]!);
                return;
              }
              if (event.key === 'Escape') {
                setMentionQuery(null);
                return;
              }
            }
            // Enter gönderir, Shift+Enter satır atlar.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          onPaste={(event) => {
            // Panodan görsel yapıştırma — ekran görüntüsü paylaşmanın en hızlı yolu.
            const files = [...event.clipboardData.files];
            if (files.length > 0 && canAttach && !disabled) {
              event.preventDefault();
              void upload(files);
            }
          }}
          placeholder={
            disabled ? t('channel.noPermission') : t('message.placeholder', { channel: channelName })
          }
          className="max-h-40 flex-1 resize-none bg-transparent text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
        />

        {/*
          Gönder düğmesi. Masaüstünde Enter yeterli ama mobil klavyede Enter
          "yeni satır" yapıyor — görünür bir düğme olmadan mesaj gönderilemiyor.
          İçerik ya da yüklenmiş dosya varken aktif.
        */}
        <button
          type="button"
          onClick={() => void send()}
          disabled={disabled || busy || (value.trim().length === 0 && ready.length === 0)}
          aria-label={t('message.send')}
          title={t('message.send')}
          className="shrink-0 rounded-full bg-[var(--color-brand)] p-1.5 text-black transition hover:bg-[var(--color-brand-strong)] disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-ink-faint)]"
        >
          <SendHorizontal size={18} />
        </button>
      </div>

      {slowmodeSeconds > 0 && (
        <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
          {t('channel.slowmode', { seconds: slowmodeSeconds })}
        </p>
      )}
    </div>
  );
}

/** Kullanıcı adındaki regex özel karakterlerini kaçır (bahsetme dönüşümü için). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uploadErrorText(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'unsupported_file_type':
      return t('message.unsupportedFile');
    case 'payload_too_large':
      return t('message.fileTooLarge');
    case 'rate_limited':
      return t('message.tooFast');
    case 'missing_attach_files':
      return t('channel.noPermission');
    default:
      return t('common.error');
  }
}
