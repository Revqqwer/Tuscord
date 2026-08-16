/**
 * Ses kanalı / katılımcı sağ tık menüsü — ses seviyesi sürgüsü DOĞRUDAN
 * menünün içinde, ayrı bir tıklama/modal gerektirmeden. `ContextMenu.tsx`
 * ile aynı konumlandırma mekaniği (sağ tık noktasında açılır, ekran
 * kenarına taşarsa içeri çekilir, dışarı tıklama/Escape kapatır) ama
 * `MenuItem` listesi tek başına bir sürgüyü barındıramadığı için ayrı bir
 * bileşen: üstte "Kanal Sesi"/"Kullanıcı Sesi" etiketi + yatay bar, altında
 * varsa normal aksiyonlar (sessize al, sunucuda sustur, engelle).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuItem } from './ContextMenu';

interface Props {
  x: number;
  y: number;
  volumeLabel: string;
  volumeValue: number;
  onVolumeChange: (value: number) => void;
  items?: MenuItem[];
  onClose: () => void;
}

export function VoiceContextMenu({ x, y, volumeLabel, volumeValue, onVolumeChange, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth) nx = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 8;
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    // Sürgüyü sürüklerken kaçak bir "click" olayı menüyü kapatmasın diye
    // dışarı tıklamayı bir sonraki tik'te bağlıyoruz (bkz. eski VolumePopover).
    const timer = setTimeout(() => {
      window.addEventListener('click', onClose);
      window.addEventListener('contextmenu', onClose);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', onClose);
      window.removeEventListener('contextmenu', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] w-56 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] py-1.5 shadow-2xl"
    >
      <div className="px-3 py-1.5">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          <span className="truncate">{volumeLabel}</span>
          <span className="shrink-0 text-[var(--color-ink-muted)]">{volumeValue}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumeValue}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-full accent-[var(--color-brand)]"
        />
      </div>

      {items && items.length > 0 && (
        <>
          <div className="my-1 h-px bg-[var(--color-line)]" />
          {items.map((item, index) =>
            item.separator ? (
              <div key={index} className="my-1 h-px bg-[var(--color-line)]" />
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-40 ${
                  item.danger
                    ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15'
                    : 'text-[var(--color-ink)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                {item.label}
              </button>
            ),
          )}
        </>
      )}
    </div>
  );
}
