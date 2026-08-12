/**
 * Yeniden kullanılabilir sağ tık (bağlam) menüsü.
 *
 * Kullanım: bir eleman üzerinde onContextMenu ile konum yakalanır, state'e
 * yazılır ve bu bileşen render edilir. Dışarı tıklama / Escape / kaydırma
 * menüyü kapatır. Ekran kenarına taşarsa içeri alınır.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  /** Ayraç: bu öğe yalnızca çizgi (label/onClick yok sayılır). */
  separator?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Ekran dışına taşarsa içeri çek.
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
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Bir sonraki tıklama menüyü kapatır (öğeye tıklama zaten kapatıyor).
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] min-w-44 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] py-1 shadow-2xl"
    >
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
    </div>
  );
}

/**
 * Sağ tık konumu + öğeleri tutan basit durum kancası.
 *
 *   const menu = useContextMenu();
 *   <div onContextMenu={(e) => menu.open(e, items)} />
 *   {menu.node}
 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  return {
    open(event: React.MouseEvent, items: MenuItem[]) {
      event.preventDefault();
      event.stopPropagation();
      setState({ x: event.clientX, y: event.clientY, items });
    },
    close: () => setState(null),
    node: state ? (
      <ContextMenu x={state.x} y={state.y} items={state.items} onClose={() => setState(null)} />
    ) : null,
  };
}
