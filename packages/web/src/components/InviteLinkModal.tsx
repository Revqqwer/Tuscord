/**
 * Davet linki modalı — tarayıcının çirkin `alert()`/`prompt()` popup'ı
 * yerine, uygulamanın kendi diyalog stiliyle (bkz. ChannelCreateModal).
 *
 * `alert()`/`prompt()` ayrıca PWA olarak yüklenmiş sekmelerde (display-mode:
 * standalone) birçok tarayıcıda ÇALIŞMAZ — sessizce hiçbir şey göstermez.
 * Bu, kullanıcı davet oluşturduğunda hiçbir şey görünmemesinin sebebiydi.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, X } from 'lucide-react';

interface Props {
  url: string;
  onClose: () => void;
}

export function InviteLinkModal({ url, onClose }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API güvenli bağlam/izin isteyebilir; başarısız olursa
      // metni seçip kullanıcının kendi Ctrl+C'sine bırak.
      const input = document.getElementById('invite-link-input') as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('invite.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Link2 size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="font-medium">{t('invite.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-sm text-[var(--color-ink-muted)]">{t('invite.shareDesc')}</p>

          <div className="flex items-center gap-2">
            <input
              id="invite-link-input"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full flex-1 truncate rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition ${
                copied
                  ? 'bg-[var(--color-online)] text-black'
                  : 'bg-[var(--color-brand)] text-black hover:bg-[var(--color-brand-strong)]'
              }`}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t('invite.copied') : t('invite.copy')}
            </button>
          </div>

          <p className="text-xs text-[var(--color-ink-faint)]">{t('invite.expires')}</p>
        </div>
      </div>
    </div>
  );
}
