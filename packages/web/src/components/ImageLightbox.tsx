/**
 * Bir mesaj görseline tıklayınca açılan tam ekran önizleme.
 *
 * Öncesinde görsele tıklamak `<a target="_blank">` ile doğrudan dosya
 * URL'sini açıyordu — tarayıcı bunu çoğu zaman önizleme yerine ANINDA
 * indirme olarak yorumluyordu (bkz. kullanıcı raporu). Şimdi tıklama yalnızca
 * bu bileşeni açar; indirme AYRI, açıkça etiketli bir düğme.
 *
 * `#root`'a PORTALLANIR (document.body'e DEĞİL): bu bileşen bir mesaj
 * satırının içinde render ediliyor ve MessageList satırları sanallaştırma
 * için `transform` ile konumlanıyor (bkz. MessageRow.tsx yorumu) — CSS'te
 * bir üst öğede `transform` varsa `position: fixed` torunları artık
 * VIEWPORT'a değil O ÖĞEYE göre konumlanır. Portal olmadan lightbox tüm
 * ekranı değil, mesaj satırının kutusunu kaplıyordu (bkz. kullanıcı raporu:
 * "tüm ekranı kaplayacak şekilde açılsın").
 *
 * `document.body`YE DEĞİL `#root`'a portallanıyor: React 17+ olay
 * delegasyonu `document`'a değil UYGULAMANIN KÖK KONTEYNERİNE (`#root`,
 * bkz. main.tsx) native dinleyici ekliyor. `document.body`'e portallarsak
 * (kök konteynerin KARDEŞİ, ATASI DEĞİL) tıklama olayı DOM'da body'ye kadar
 * balonlaşıyor ama hiçbir zaman #root'tan GEÇMİYOR — React'in dinleyicisi
 * olayı hiç görmüyor, onClick'ler ateşlenmiyor (yalnızca window'a bağlı
 * Escape tuşu çalışıyordu, bkz. kullanıcı raporu: "x veya boş yere basınca
 * kapanmıyor sadece esc çalışıyor"). `#root`'un ALTINA portallamak hem bu
 * sorunu çözüyor HEM DE yukarıdaki transform sorununu çözmeye devam ediyor
 * (çünkü #root, mesaj satırının transform'lu atası DEĞİL).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, Minus, Plus, X } from 'lucide-react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface Props {
  url: string;
  filename: string;
  onClose: () => void;
}

export function ImageLightbox({ url, filename, onClose }: Props) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function download() {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      {/*
        z-10 KASITLI: aşağıdaki <img>'e uygulanan CSS `transform` (yakınlaştırma)
        kendi başına bir stacking context AÇIYOR — bu da onu, DOM'da ondan
        ÖNCE gelen ama `z-index: auto` olan bu araç çubuğunun ÜSTÜNE
        çiziyordu, düğmeler tıklanamaz hale geliyordu (bkz. kullanıcı raporu:
        "x kapatma tuşu ... sadece esc tuşu ile kapanıyor"). z-10 bunu
        aşıyor.
      */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-1 shadow-lg">
        <IconButton
          label={t('message.zoomOut')}
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
          }}
          disabled={zoom <= MIN_ZOOM}
        >
          <Minus size={16} />
        </IconButton>
        <span className="w-12 select-none text-center text-xs text-[var(--color-ink-muted)]">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          label={t('message.zoomIn')}
          onClick={(e) => {
            e.stopPropagation();
            setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
          }}
          disabled={zoom >= MAX_ZOOM}
        >
          <Plus size={16} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-[var(--color-line)]" />
        <IconButton
          label={t('message.download')}
          onClick={(e) => {
            e.stopPropagation();
            download();
          }}
        >
          <Download size={16} />
        </IconButton>
        <IconButton
          label={t('common.close')}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={16} />
        </IconButton>
      </div>

      <div
        className="flex h-full w-full items-center justify-center overflow-auto"
        onClick={onClose}
      >
        {/*
          Genişlik/yükseklik TÜM EKRANA sabit (100vh/100vw) — küçük bir ekran
          görüntüsü (ör. 200×150) `object-fit: contain` ile yalnızca "taşarsa
          küçült" mantığından yararlanamıyordu, kendi doğal boyutunda kalıp
          ekranın ortasında minicik görünüyordu (bkz. kullanıcı raporu:
          "daha büyük ölçekte görüntülensin", sonra "tüm ekranı
          kaplayabilecek"). Şimdi KÜÇÜK görseller BÜYÜTÜLÜR, büyük görseller
          sığdırılır, en boy oranı bozulmadan ekranın tamamına kadar
          büyüyebilir — yakınlaştırma düğmeleri bu temelden EK bir çarpan
          uygular.

          pointer-events-none KASITLI: `object-contain` yalnızca görselin
          İÇERİĞİNİ resmin kutusu içinde ortalar, kutunun kendisi (tıklama
          alanı) yine de TÜM EKRANI kaplıyor — küçük bir görselde çevresi
          "boş" görünen alan bile aslında img'in hit-test kutusunun İÇİNDE.
          stopPropagation ile eskiden bu yüzden "boş" görünen yerler bile
          tıklanınca kapanmıyordu (bkz. kullanıcı raporu). pointer-events-none
          ile tıklamalar img'in ALTINDAKİ arkaplana düşer, arkaplanın
          onClick={onClose}'u her yerde çalışır — araç çubuğu (üstte, kendi
          stopPropagation'ıyla) hariç.
        */}
        <img
          src={url}
          alt={filename}
          style={{ transform: `scale(${zoom})`, transition: 'transform 120ms ease-out' }}
          className="pointer-events-none h-screen w-screen select-none object-contain"
          draggable={false}
        />
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1.5 text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
