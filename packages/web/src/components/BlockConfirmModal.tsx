/**
 * Engelleme onay modalı — tarayıcının çirkin `confirm()` popup'ı yerine
 * (bkz. InviteLinkModal.tsx, aynı gerekçe). Ayrıca engelin nasıl
 * kaldırılacağını burada açıkça söylüyor — kullanıcı "peki şimdi ne
 * yapacağım" diye Kullanıcı Ayarları'nı aramasın.
 */

import { useTranslation } from 'react-i18next';
import { Ban, X } from 'lucide-react';

interface Props {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BlockConfirmModal({ name, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={t('profile.block')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Ban size={18} className="text-[var(--color-danger)]" />
          <h2 className="font-medium">{t('profile.block')}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-5">
          <p className="text-sm text-[var(--color-ink)]">
            {t('profile.blockConfirm', { name })}
          </p>
          <p className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
            {t('profile.blockUndoHint')}
          </p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded bg-[var(--color-surface-2)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-surface-3)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 rounded bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              {t('profile.block')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
