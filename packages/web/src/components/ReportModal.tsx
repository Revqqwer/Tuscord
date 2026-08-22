/**
 * Rapor gönderme modalı — tarayıcının çirkin `prompt()`'u yerine (bkz.
 * kullanıcı isteği). Hedef `store.reportTarget`'ta tutulur, bu bileşen
 * ChatShell kökünde BİR KEZ mount edilir (bkz. BlockConfirmModal.tsx aynı
 * desen) — hem mesaj hem kullanıcı raporlaması buradan geçer.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, X } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../store';

export function ReportModal() {
  const { t } = useTranslation();
  const target = useStore((s) => s.reportTarget);
  const setReportTarget = useStore((s) => s.setReportTarget);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!target) return null;

  function close() {
    setReportTarget(null);
    setReason('');
    setSent(false);
  }

  async function submit() {
    if (!target || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post('/reports', {
        targetType: target.targetType,
        targetId: target.targetId,
        reason: reason.trim(),
      });
      setSent(true);
      setTimeout(close, 1200);
    } catch {
      // Sessizce geç — sınır aşımı/format hatası kritik değil, kullanıcı tekrar deneyebilir.
    } finally {
      setBusy(false);
    }
  }

  const title = target.targetType === 'user' ? t('voice.reportUser') : t('message.report');
  const prompt =
    target.targetType === 'user' ? t('voice.reportUserPrompt') : t('message.reportPrompt');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
          <Flag size={18} className="text-[var(--color-danger)]" />
          <h2 className="font-medium">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-5">
          {sent ? (
            <p role="status" className="text-sm text-[var(--color-online)]">
              {t('message.reportSent')}
            </p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-ink-muted)]">{prompt}</span>
                <textarea
                  autoFocus
                  rows={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full resize-none rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
                />
              </label>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 rounded bg-[var(--color-surface-2)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-surface-3)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || reason.trim().length < 3}
                  className="flex-1 rounded bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {t('message.report')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
