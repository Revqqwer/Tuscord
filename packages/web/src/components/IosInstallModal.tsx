/**
 * Uygulama yükleme talimatı — üç durum için de tek modal:
 *  - iOS: Safari'de `beforeinstallprompt` hiç YOK, programatik yükleme
 *    tetiklenemez (bkz. lib/platform.ts isIOS yorumu). Tek yol: Paylaş →
 *    Ana Ekrana Ekle adımlarını göstermek.
 *  - Android: event henüz ateşlenmemiş olabilir (bkz. Homepage.tsx
 *    handleMobileInstall) — tarayıcı menüsünden (⋮) aynı sonuca ulaşılır.
 *  - Masaüstü: buton HER ZAMAN görünür (bkz. kullanıcı raporu: "kurulu
 *    olsa da buton kaybolmasın") ama `beforeinstallprompt` yoksa (zaten
 *    yüklü ya da Chrome'un kendi soğuma politikası) tıklamak hiçbir şey
 *    yapmaz — o yüzden nereye bakması gerektiğini söylüyoruz.
 * (bkz. BlockConfirmModal.tsx, aynı modal deseni.)
 */

import { useTranslation } from 'react-i18next';
import { EllipsisVertical, Monitor, Share, SquarePlus, X } from 'lucide-react';

interface Props {
  platform: 'ios' | 'android' | 'desktop';
  onClose: () => void;
}

export function IosInstallModal({ platform, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('homepage.iosInstallTitle')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="font-medium">{t('homepage.iosInstallTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        {platform === 'desktop' ? (
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
                <Monitor size={18} className="text-[var(--color-brand)]" />
              </div>
              <p className="text-sm text-[var(--color-ink)]">{t('homepage.desktopInstallHint')}</p>
            </div>
            <p className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
              {t('homepage.desktopInstallAlreadyHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
                {platform === 'ios' ? (
                  <Share size={18} className="text-[var(--color-brand)]" />
                ) : (
                  <EllipsisVertical size={18} className="text-[var(--color-brand)]" />
                )}
              </div>
              <p className="text-sm text-[var(--color-ink)]">
                {platform === 'ios' ? t('homepage.iosInstallStep1') : t('homepage.androidInstallStep1')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)]">
                <SquarePlus size={18} className="text-[var(--color-brand)]" />
              </div>
              <p className="text-sm text-[var(--color-ink)]">{t('homepage.iosInstallStep2')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
