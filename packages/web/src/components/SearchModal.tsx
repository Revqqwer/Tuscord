/**
 * Mesaj arama — sunucu başlığındaki büyüteçten açılır.
 * Postgres full-text arama (yalnızca görünür kanallarda). Sonuca tıklayınca
 * o kanala geçer ve mesaja atlar.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import type { APIMessage } from '@tuscord/shared';
import { api } from '../lib/api';
import { Avatar } from './Avatar';

interface Props {
  guildId: string;
  onClose: () => void;
  onJump: (channelId: string, messageId: string) => void;
}

export function SearchModal({ guildId, onClose, onJump }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<APIMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    // Yazma bittikten 300ms sonra ara — her tuşta istek atma.
    timer.current = setTimeout(() => {
      setLoading(true);
      void api
        .get<APIMessage[]>(`/guilds/${guildId}/messages/search?q=${encodeURIComponent(query.trim())}`)
        .then((list) => setResults(list))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, guildId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('search.title')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Search size={18} className="text-[var(--color-ink-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent outline-none placeholder:text-[var(--color-ink-faint)]"
          />
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('search.hint')}</p>
          ) : loading ? (
            <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>
          ) : results && results.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--color-ink-faint)]">{t('search.noResults')}</p>
          ) : (
            (results ?? []).map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => onJump(message.channelId, message.id)}
                className="flex w-full items-start gap-2 rounded p-2 text-left hover:bg-[var(--color-surface-2)]"
              >
                <Avatar name={message.author.displayName ?? message.author.username} avatarUrl={message.author.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium">{message.author.displayName ?? message.author.username}</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {new Date(message.createdAt).toLocaleString('tr', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <div className="truncate text-sm text-[var(--color-ink-muted)]">{message.content}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
