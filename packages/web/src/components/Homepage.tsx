/**
 * tuscord.com açılış sayfası — giriş yapmamış ziyaretçiyi karşılar.
 *
 * discord.com'un iskeletine benziyor (üstte logo + Giriş Yap, altta iki
 * büyük buton) ama KASITLI OLARAK üst menü yok: Keşfet/Emniyet/Blog/Kariyer
 * gibi sayfaların hiçbiri yok, hepsi tek bir "gir" akışına çıkıyor.
 *
 * TEK EKRAN, kaydırma YOK: kök `h-dvh overflow-hidden`. Geniş ekranda (lg+)
 * metin ve önizleme YAN YANA — tek sütunda ortalayıp yazıyı küçülterek
 * sığdırmak geniş ekranda içeriği küçük bir kutuya hapsedip etrafını boş
 * bırakıyordu. İki sütun, genişliği gerçekten kullanıyor: metin daha büyük
 * kalabiliyor, boşluk azalıyor. Dar ekranda (mobil/tablet) hâlâ tek sütun —
 * yan yana koyacak genişlik yok.
 *
 * Bir router yok (bkz. App.tsx yorumu) — buradaki iki buton da doğrudan
 * `onEnter` çağırıp App.tsx'in `/login` durumuna geçmesini sağlıyor; ikisi
 * de aynı hedefe gidiyor (Discord'da da "tarayıcıda aç" zaten aynı giriş
 * ekranına düşer).
 */

import { useTranslation } from 'react-i18next';
import { Download, Globe } from 'lucide-react';
import { WalrusLoader } from './WalrusLoader';
import { LegalFooter } from './LegalFooter';

interface Props {
  onEnter: () => void;
}

export function Homepage({ onEnter }: Props) {
  const { t } = useTranslation();

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[var(--color-surface-0)]">
      <BackgroundWalruses />

      <header className="relative z-10 flex shrink-0 items-center gap-2 px-4 py-2.5 sm:px-8 sm:py-3">
        <img src="/icon.svg" alt="" width={30} height={30} className="rounded-lg" />
        <span className="text-lg font-semibold text-[var(--color-ink)]">Tuscord</span>
        <button
          type="button"
          onClick={onEnter}
          className="ml-auto shrink-0 rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm font-semibold text-[var(--color-surface-0)] transition hover:bg-white"
        >
          {t('homepage.login')}
        </button>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden px-4 py-2 text-center sm:px-10 lg:px-16 xl:px-24">
        {/* Masaüstünde (lg+): iki sütunun ÜSTÜNDE, aralarındaki boşlukta,
            sol/sağ/üst/alt çevresindeki elemanlara göre ortalanmış logo.
            Dar ekranda gizli — orada mors zaten sol sütunun içinde, metnin
            üstünde (aşağıda, ayrı bir render). */}
        <div className="hidden shrink-0 lg:block">
          <WalrusLoader size={208} />
        </div>

        {/* Sütun sırası: masaüstünde metin solda + önizleme sağda, dar
            ekranda tek sütun. */}
        <div className="flex flex-col items-center gap-4 lg:w-full lg:flex-row lg:justify-center lg:gap-16 lg:text-left xl:gap-20">
          {/* Sol sütun (lg+): metin + butonlar. Dar ekranda tek sütunun tamamı. */}
          <div className="flex flex-col items-center lg:max-w-xl lg:shrink-0 lg:items-start">
            <div className="lg:hidden">
              <WalrusLoader size={72} />
            </div>

            <h1 className="mt-1 text-3xl font-extrabold uppercase leading-[1.05] tracking-tight text-[var(--color-ink)] sm:text-4xl lg:mt-0 lg:text-6xl xl:text-7xl">
              {t('homepage.headline')}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-base text-[var(--color-ink-muted)] sm:text-lg lg:mx-0 lg:mt-5 lg:text-xl">
              {t('homepage.subtitle')}
            </p>

            <div className="mt-5 flex shrink-0 flex-col items-center gap-2.5 sm:flex-row sm:gap-3 lg:mt-8">
              {/* Masaüstü uygulaması yayında — Electron kabuğu, web arayüzünü
                  aynen yükler (bkz. packages/desktop). */}
              <a
                href="/downloads/Tuscord-Setup-0.1.4.exe"
                title={t('homepage.downloadLive')}
                className="flex items-center gap-2 rounded-full bg-[var(--color-surface-2)] px-6 py-3 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-surface-3)]"
              >
                <Download size={18} />
                {t('homepage.downloadWindows')}
                <span className="rounded-full bg-[var(--color-brand)]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-brand)]">
                  {t('homepage.downloadLive')}
                </span>
              </a>
              <button
                type="button"
                onClick={onEnter}
                className="flex items-center gap-2 rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[var(--color-brand-strong)]"
              >
                <Globe size={18} />
                {t('homepage.openInBrowser')}
              </button>
            </div>
          </div>

          {/* Sağ sütun (lg+): uygulama önizlemesi — gerçek illüstrasyon yerine,
              mevcut arayüzün renk paletiyle sadeleştirilmiş bir maket (bkz.
              sohbet için hazır bir görsel varlığımız yok, önceki konuşma:
              illüstratörle koleksiyon). Dar ekranda gizli: hem yer yok hem
              tek-ekran kısıtına uymuyor. */}
          <div className="hidden w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl md:block lg:max-w-none lg:flex-1">
            <div className="flex h-7 items-center gap-1.5 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-idle)]/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-online)]/60" />
            </div>
            <div className="flex h-44 md:h-56 lg:h-72 xl:h-80">
              <div className="hidden w-44 shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface-1)] p-3.5 text-left lg:block">
                <div className="mb-3 h-3 w-24 rounded bg-[var(--color-ink-faint)]/30" />
                {['genel', 'oyun-önerileri', 'ses-lobi'].map((name, i) => (
                  <div
                    key={name}
                    className={`mb-1.5 flex items-center gap-1.5 rounded px-2 py-1.5 text-sm ${
                      i === 0
                        ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)]'
                        : 'text-[var(--color-ink-faint)]'
                    }`}
                  >
                    <span className="opacity-70">{i === 2 ? '🔊' : '#'}</span> {name}
                  </div>
                ))}
              </div>
              <div className="flex flex-1 flex-col justify-end gap-3 p-4">
                {[60, 40, 75].map((w, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span
                      className="h-8 w-8 shrink-0 rounded-full"
                      style={{ background: i % 2 === 0 ? 'var(--color-brand)' : 'var(--color-idle)' }}
                    />
                    <span
                      className="h-3.5 rounded bg-[var(--color-surface-3)]"
                      style={{ width: `${w}%`, maxWidth: 320 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="relative z-10 shrink-0 px-4 pb-2 sm:pb-3">
        <LegalFooter />
      </div>
    </div>
  );
}

/**
 * Sağda/solda soluk, arka planda duran dekoratif mors sürüsü.
 *
 * Gerçek illüstratör pozları yerine (elimizde çizim yeteneği/varlığı yok —
 * bkz. önceki konuşma) AYNI ikon şeklinin döndürme/opaklık/ton varyasyonları:
 * 0°'ye yakın = ayakta, 90°/-90° = yatan, ~15-25° = duvara yaslanan izlenimi.
 * Hepsi marka turkuazının aynı ailesinde kalıyor (soluk turkuaz, gri-teal),
 * rastgele renklere kaymıyor. Yalnızca geniş ekranlarda (lg+): dar ekranda
 * hem yer yok hem tek-ekran kısıtını riske atar.
 */
function BackgroundWalruses() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden lg:block"
    >
      <MiniWalrus className="-left-16 top-8 h-40 w-40" rotate={-10} opacity={0.1} />
      <MiniWalrus className="-left-12 bottom-28 h-28 w-28" rotate={92} opacity={0.07} hueShift={-8} />
      <MiniWalrus className="left-10 top-1/2 h-16 w-16 -translate-y-1/2" rotate={22} opacity={0.06} />

      <MiniWalrus className="-right-14 top-10 h-36 w-36" rotate={16} opacity={0.1} hueShift={6} />
      <MiniWalrus className="-right-10 bottom-24 h-24 w-24" rotate={-88} opacity={0.08} />
      <MiniWalrus className="right-8 top-1/3 h-14 w-14" rotate={-24} opacity={0.06} />
    </div>
  );
}

function MiniWalrus({
  className,
  rotate,
  opacity,
  hueShift = 0,
}: {
  className: string;
  rotate: number;
  opacity: number;
  hueShift?: number;
}) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={`absolute ${className}`}
      style={{ transform: `rotate(${rotate}deg)`, opacity, filter: `hue-rotate(${hueShift}deg)` }}
    >
      <circle cx="256" cy="238" r="150" fill="#14b8a6" />
      <ellipse cx="256" cy="300" rx="92" ry="74" fill="#0d9488" />
      <path
        d="M232 322c-6 42-12 74-24 104-4 10-18 8-19-3-3-34 4-72 20-104z"
        fill="#f5f7fa"
      />
      <path
        d="M280 322c6 42 12 74 24 104 4 10 18 8 19-3 3-34-4-72-20-104z"
        fill="#f5f7fa"
      />
    </svg>
  );
}
