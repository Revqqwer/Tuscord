/**
 * Geçici kullanıcı istatistikleri raporu — yalnızca platform yöneticileri.
 * `/admin/rapor` yoluna gelir (bkz. App.tsx, davet/parola-sıfırlama ile aynı
 * path-tabanlı desen — router yok). Kalıcı bir özellik olacağı garanti değil
 * (bkz. kullanıcı isteği: "devamında bu sayfayı kullanmayabiliriz"), bu
 * yüzden kendi başına duran, minimal bağımlılıklı bir bileşen: yeni bir grafik
 * kütüphanesi eklemek yerine düz SVG çizgi grafik.
 *
 * Erişim: sunucu tarafı asıl sınır (`/admin/stats/daily` isAdmin değilse 404
 * döner — bkz. routes/admin.ts). Buradaki `isAdmin` kontrolü yalnızca arayüz
 * kolaylığı, güvenlik sınırı değil.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';

interface DailyStat {
  date: string;
  uniqueUsers: number;
  newRegistrations: number;
  peakConcurrent: number;
}

const DAY_OPTIONS = [7, 30, 90] as const;

export function AdminStats({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30);
  const [data, setData] = useState<DailyStat[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    void api
      .get<DailyStat[]>(`/admin/stats/daily?days=${days}`)
      .then(setData)
      .catch(() => setError(true));
  }, [days]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      registrations: data.reduce((sum, d) => sum + d.newRegistrations, 0),
      peak: Math.max(0, ...data.map((d) => d.peakConcurrent)),
      avgUnique: data.length ? Math.round(data.reduce((sum, d) => sum + d.uniqueUsers, 0) / data.length) : 0,
    };
  }, [data]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface-0)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('common.back')}
          className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={18} />
        </button>
        <TrendingUp size={18} className="text-[var(--color-brand)]" />
        <h1 className="text-lg font-semibold">{t('adminStats.title')}</h1>

        <div className="ml-auto flex gap-1">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                days === option
                  ? 'bg-[var(--color-brand)] text-black'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              {t('adminStats.days', { count: option })}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1 p-5">
        {error ? (
          <p className="p-8 text-center text-sm text-[var(--color-danger)]">{t('common.error')}</p>
        ) : !data ? (
          <p className="p-8 text-center text-sm text-[var(--color-ink-faint)]">{t('common.loading')}</p>
        ) : (
          <>
            {totals && (
              <div className="mb-6 grid grid-cols-3 gap-3">
                <SummaryTile label={t('adminStats.avgUnique')} value={totals.avgUnique} />
                <SummaryTile label={t('adminStats.totalRegistrations')} value={totals.registrations} />
                <SummaryTile label={t('adminStats.periodPeak')} value={totals.peak} />
              </div>
            )}

            <ChartCard
              title={t('adminStats.uniqueUsersTitle')}
              subtitle={t('adminStats.uniqueUsersSubtitle')}
              data={data}
              field="uniqueUsers"
              color="var(--color-brand)"
            />
            <ChartCard
              title={t('adminStats.registrationsTitle')}
              subtitle={t('adminStats.registrationsSubtitle')}
              data={data}
              field="newRegistrations"
              color="var(--color-online)"
            />
            <ChartCard
              title={t('adminStats.peakTitle')}
              subtitle={t('adminStats.peakSubtitle')}
              data={data}
              field="peakConcurrent"
              color="var(--color-dnd)"
            />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4">
      <div className="text-2xl font-semibold">{value.toLocaleString('tr')}</div>
      <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{label}</div>
    </div>
  );
}

/* ---------------- Çizgi grafik (bağımlılıksız, düz SVG) ---------------- */

const CHART_HEIGHT = 200;
const CHART_WIDTH = 800;
const PADDING = { top: 16, right: 16, bottom: 28, left: 36 };

function ChartCard({
  title,
  subtitle,
  data,
  field,
  color,
}: {
  title: string;
  subtitle: string;
  data: DailyStat[];
  field: keyof Pick<DailyStat, 'uniqueUsers' | 'newRegistrations' | 'peakConcurrent'>;
  color: string;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);

  const values = data.map((d) => d[field]);
  const maxValue = Math.max(1, ...values); // 1: tüm gün 0 ise eksen çökmesin.

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const points = data.map((d, i) => {
    const x = PADDING.left + (data.length === 1 ? innerWidth / 2 : (i / (data.length - 1)) * innerWidth);
    const y = PADDING.top + innerHeight - (d[field] / maxValue) * innerHeight;
    return { x, y, value: d[field], date: d.date };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? PADDING.left} ${PADDING.top + innerHeight} L ${PADDING.left} ${PADDING.top + innerHeight} Z`;

  // Eksende 4-6 tarih etiketi yeter — her gün sıkışıp okunmaz olmasın.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="mb-5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4">
      <div className="mb-3">
        <h2 className="font-medium">{title}</h2>
        <p className="text-xs text-[var(--color-ink-faint)]">{subtitle}</p>
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
      >
        {/* Yatay ızgara + Y ekseni etiketleri (0 ve tepe değer) */}
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top}
          stroke="var(--color-line)"
          strokeDasharray="2,3"
        />
        <text x={4} y={PADDING.top + 4} className="fill-[var(--color-ink-faint)] text-[10px]">
          {maxValue.toLocaleString('tr')}
        </text>
        <line
          x1={PADDING.left}
          y1={PADDING.top + innerHeight}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top + innerHeight}
          stroke="var(--color-line)"
        />
        <text x={4} y={PADDING.top + innerHeight + 4} className="fill-[var(--color-ink-faint)] text-[10px]">
          0
        </text>

        {/* Alan dolgusu + çizgi */}
        <path d={areaPath} fill={color} opacity={0.12} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

        {/* Noktalar + hover hedefleri */}
        {points.map((p, i) => (
          <g key={p.date}>
            {i % labelEvery === 0 && (
              <text
                x={p.x}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-[var(--color-ink-faint)] text-[10px]"
              >
                {formatShortDate(p.date)}
              </text>
            )}
            <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} fill={color} />
            <rect
              x={p.x - innerWidth / data.length / 2}
              y={PADDING.top}
              width={innerWidth / data.length}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          </g>
        ))}
      </svg>

      <div className="mt-1 h-5 text-center text-xs text-[var(--color-ink-muted)]">
        {hover !== null && points[hover] && (
          <span>
            {formatFullDate(points[hover]!.date)} — <strong>{points[hover]!.value.toLocaleString('tr')}</strong>{' '}
            {t('adminStats.person')}
          </span>
        )}
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr', { day: 'numeric', month: 'short' });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr', { day: 'numeric', month: 'long', year: 'numeric' });
}
