/**
 * Kullanıcı avatarı — görsel varsa resim, yoksa adın baş harfleri.
 *
 * Tek yerde toplandı: mesaj listesi, üye listesi, profil kartı ve alt çubuk
 * hepsi bunu kullanır. Baş harfler için ada göre sabit bir renk üretilir —
 * aynı kişi her yerde aynı renkte görünür.
 */

import type { PresenceStatus } from '@tuscord/shared';

interface Props {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  /**
   * Çevrimiçi durum noktası (verilirse sağ altta). 'invisible' asla buraya
   * gelmemeli (bkz. server gateway/index.ts setPresence — başkalarına hep
   * 'offline' yayınlanır) ama tip STATUS_COLOR'da karşılığı olmadığı için
   * zararsız (nokta hiç boyanmaz).
   */
  status?: PresenceStatus;
  /** Verilirse ada göre otomatik baş harf yerine bu kullanılır (bkz. sunucu ikonu, initialsFromName). */
  initials?: string;
}

/** Ada göre deterministik bir arka plan tonu (baş harf modu). */
function hueFrom(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--color-online)',
  idle: 'var(--color-idle)',
  dnd: 'var(--color-dnd)',
  offline: 'var(--color-ink-faint)',
};

export function Avatar({ name, avatarUrl, size = 40, status, initials: initialsOverride }: Props) {
  const initials = initialsOverride ?? name.slice(0, 2).toLocaleUpperCase('tr');
  const dot = Math.max(8, Math.round(size * 0.28));

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex items-center justify-center rounded-full font-semibold text-white"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.4),
            background: `hsl(${hueFrom(name)} 45% 42%)`,
          }}
        >
          {initials}
        </span>
      )}
      {status && (
        <span
          className="absolute rounded-full border-2"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
            background: STATUS_COLOR[status],
            borderColor: 'var(--color-surface-1)',
          }}
        />
      )}
    </span>
  );
}
