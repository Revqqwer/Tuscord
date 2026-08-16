/**
 * Bir mesaj görseline tıklayınca açılan tam ekran önizleme.
 *
 * Öncesinde görsele tıklamak `<a target="_blank">` ile doğrudan dosya
 * URL'sini açıyordu — tarayıcı bunu çoğu zaman önizleme yerine ANINDA
 * indirme olarak yorumluyordu (bkz. kullanıcı raporu). Şimdi tıklama yalnızca
 * bu bileşeni açar; indirme AYRI, açıkça etiketli bir düğme.
 */

import { useEffect, useState } from 'react';
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-1 shadow-lg">
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
        className="flex h-full w-full items-center justify-center overflow-auto p-12"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          Genişlik/yükseklik BİLEREK ekranın büyük bir kısmına sabit
          (%85-90) — küçük bir ekran görüntüsü (ör. 200×150) `object-fit:
          contain` ile yalnızca "taşarsa küçült" mantığından yararlanamıyordu,
          kendi doğal boyutunda kalıp ekranın ortasında minicik görünüyordu
          (bkz. kullanıcı raporu: "daha büyük ölçekte görüntülensin"). Şimdi
          KÜÇÜK görseller BÜYÜTÜLÜR, büyük görseller sığdırılır — yakınlaştırma
          düğmeleri bu "sığdırılmış" temelden EK bir çarpan uygular.
        */}
        <img
          src={url}
          alt={filename}
          style={{ transform: `scale(${zoom})`, transition: 'transform 120ms ease-out' }}
          className="h-[85vh] w-[90vw] select-none object-contain"
          draggable={false}
        />
      </div>
    </div>
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
