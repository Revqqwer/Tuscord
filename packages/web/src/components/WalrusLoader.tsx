/**
 * Animasyonlu mors — açılış/yükleme ekranı.
 *
 * İsim TUSK'tan geliyor, bu yüzden marka simgesi bir mors. Animasyon saf
 * CSS/SMIL değil, inline transform-origin ile: dişler hafifçe zıplar, bıyıklar
 * kıpırdar. Ağır kütüphane yok — sadece SVG + CSS keyframe.
 */

interface Props {
  /** Yükleme metni. */
  label?: string;
}

export function WalrusLoader({ label }: Props) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width="96"
        height="96"
        viewBox="0 0 512 512"
        role="img"
        aria-label="Tuscord"
        className="walrus"
      >
        {/* Baş — hafifçe sallanır */}
        <g className="walrus-head">
          <circle cx="256" cy="238" r="150" fill="#14b8a6" />
          <ellipse cx="256" cy="300" rx="92" ry="74" fill="#0d9488" />
          <circle cx="256" cy="286" r="26" fill="#0f1115" />

          {/* Gözler — arada bir kırpar */}
          <g className="walrus-eyes">
            <circle cx="206" cy="222" r="20" fill="#0f1115" />
            <circle cx="306" cy="222" r="20" fill="#0f1115" />
            <circle cx="212" cy="216" r="7" fill="#e6e8ec" />
            <circle cx="312" cy="216" r="7" fill="#e6e8ec" />
          </g>

          {/* Dişler — sırayla zıplar */}
          <path
            className="walrus-tusk walrus-tusk-left"
            d="M232 322c-6 42-12 74-24 104-4 10-18 8-19-3-3-34 4-72 20-104z"
            fill="#f5f7fa"
          />
          <path
            className="walrus-tusk walrus-tusk-right"
            d="M280 322c6 42 12 74 24 104 4 10 18 8 19-3 3-34-4-72-20-104z"
            fill="#f5f7fa"
          />

          <g stroke="#0f1115" strokeWidth="6" strokeLinecap="round" opacity="0.85">
            <line x1="214" y1="300" x2="150" y2="292" />
            <line x1="214" y1="312" x2="156" y2="320" />
            <line x1="298" y1="300" x2="362" y2="292" />
            <line x1="298" y1="312" x2="356" y2="320" />
          </g>
        </g>
      </svg>

      {label && <p className="text-sm text-[var(--color-ink-muted)]">{label}</p>}
    </div>
  );
}
