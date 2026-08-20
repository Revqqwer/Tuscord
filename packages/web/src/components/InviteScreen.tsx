/**
 * Davet açılış ekranı: `/davet/<token>`.
 *
 * `token` bir davet kodu (`9bKj4axx`) OLABİLECEĞİ GİBİ sunucu adı da
 * olabilir (`/davet/Genel Sohbet`) — App.tsx ikisini ayrıştırmadan buraya
 * verir. Önce davet kodu önizlemesi denenir; sunucu `unknown_invite`
 * dönerse (kod yok/süresi dolmuş) token sunucu adı sayılıp ikinci bir
 * önizleme denenir. İki önizleme de herkese açık, giriş gerektirmez —
 * katılma (join) adımı gerektirir.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../lib/api';
import { initialsFromName } from '../lib/initials';

interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  description: string | null;
}

type Preview =
  | { kind: 'code'; code: string; guild: GuildSummary; memberCount: number }
  | { kind: 'name'; name: string; guild: GuildSummary; memberCount: number };

interface Props {
  token: string;
  /** Oturum açık mı — kapalıysa önce giriş yapması söylenir. */
  authenticated: boolean;
  /**
   * "Giriş yap"a buradan basıldı — App.tsx giriş ekranını gösterir, giriş
   * başarılı olunca bu ekrana AYNI davetle geri döner. O dönüşte `preview`
   * zaten hazırsa katılma otomatik denenir (bkz. aşağıdaki effect) —
   * kullanıcı "giriş yap"a bastıktan sonra tekrar "Katıl"a basmak zorunda
   * kalmasın diye (bkz. kullanıcı raporu: "giriş yaptıktan sonra redirect
   * etsin doğrudan sunucuya").
   */
  onRequestLogin: () => void;
  /**
   * true YALNIZCA `onRequestLogin` üzerinden giriş ekranına gidip
   * DÖNÜLDÜĞÜNDE — App.tsx bunu taşıyor (bu bileşen giriş sırasında
   * unmount olur, kendi state'i hatırlayamaz). Zaten giriş yapmış birinin
   * linki rastgele açması otomatik katılıma yol AÇMAMALI (bkz. aşağıdaki
   * effect) — yalnızca bu bayrak varken otomatik dener.
   */
  autoJoin: boolean;
  onJoined: (guildId: string) => void;
  onCancel: () => void;
}

export function InviteScreen({ token, authenticated, onRequestLogin, autoJoin, onJoined, onCancel }: Props) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Giriş ekranından dönüşte bir kez otomatik katılım dene. */
  const autoJoinedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);

    async function resolve() {
      // Kod önizlemesini dene. Hata sebebi ÖNEMLİ DEĞİL — 404 (kod yok) kadar
      // 400 (token 12 karakteri aşıyor, davet kodu şekline uymuyor) de burada
      // düşer; ikisi de "bu bir davet kodu değil" anlamına gelir ve isim
      // denemesine geçilir. Yalnızca 404'e bakmak, uzun sunucu adlarının
      // (12+ karakter) hiç denenmeden "Hata" gösterip kalmasına yol açıyordu.
      try {
        const byCode = await api.get<{ guild: GuildSummary; memberCount: number }>(`/invites/${token}`);
        if (!cancelled) setPreview({ kind: 'code', code: token, ...byCode });
        return;
      } catch {
        // Devam — sunucu adı olarak dene.
      }

      try {
        const byName = await api.get<{ guild: GuildSummary; memberCount: number }>(
          `/guilds/preview/${encodeURIComponent(token)}`,
        );
        if (!cancelled) setPreview({ kind: 'name', name: token, ...byName });
      } catch {
        if (!cancelled) setError(t('invite.invalid'));
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  async function join() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const guild =
        preview.kind === 'code'
          ? await api.post<{ id: string }>(`/invites/${preview.code}/join`)
          : await api.post<{ id: string }>('/guilds/join', { name: preview.name });
      onJoined(guild.id);
    } catch (caught) {
      const codeName = caught instanceof ApiError ? caught.code : 'unknown';
      setError(
        codeName === 'banned'
          ? t('invite.banned')
          : codeName === 'account_too_new'
            ? t('invite.tooNew')
            : codeName === 'email_not_verified'
              ? t('invite.needsVerifiedEmail')
              : t('invite.invalid'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Giriş ekranından ("Giriş yap ve katıl") dönünce otomatik katıl — bir
  // kez. `preview` henüz gelmemişse (yavaş ağ) bu effect authenticated/
  // preview değiştikçe tekrar çalışır, ilk elverişli anda tetiklenir.
  useEffect(() => {
    if (!autoJoin || !authenticated || !preview || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, authenticated, preview]);

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-surface-0)] p-4">
      <div className="w-full max-w-sm rounded-lg bg-[var(--color-surface-1)] p-6 text-center shadow-xl">
        {preview ? (
          <>
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface-3)] text-xl font-semibold">
              {initialsFromName(preview.guild.name)}
            </div>
            <p className="mb-1 text-sm text-[var(--color-ink-muted)]">{t('invite.invitedTo')}</p>
            <h1 className="mb-1 text-xl font-semibold">{preview.guild.name}</h1>
            {preview.guild.description && (
              <p className="mb-2 text-sm text-[var(--color-ink-muted)]">
                {preview.guild.description}
              </p>
            )}
            <p className="mb-5 text-sm text-[var(--color-ink-faint)]">
              {t('guild.memberCount', { count: preview.memberCount })}
            </p>

            {error && (
              <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}

            {authenticated ? (
              <button
                type="button"
                onClick={() => void join()}
                disabled={busy}
                className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('invite.accept')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onRequestLogin}
                className="w-full rounded bg-[var(--color-brand)] px-4 py-2 font-medium text-black transition hover:bg-[var(--color-brand-strong)]"
              >
                {t('invite.loginButton')}
              </button>
            )}

            <button
              type="button"
              onClick={onCancel}
              className="mt-3 w-full text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <p className={error ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]'}>
              {error ?? t('common.loading')}
            </p>
            {error && (
              <button
                type="button"
                onClick={onCancel}
                className="mt-4 w-full rounded bg-[var(--color-surface-3)] px-4 py-2 text-sm"
              >
                {t('common.close')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
