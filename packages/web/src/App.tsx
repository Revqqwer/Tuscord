import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelfUser } from '@tuscord/shared';
import { api } from './lib/api';
import { useStore } from './store';
import { useGateway } from './hooks/useGateway';
import { AdminStats } from './components/AdminStats';
import { AuthScreen } from './components/AuthScreen';
import { BotInviteScreen } from './components/BotInviteScreen';
import { ChatShell } from './components/ChatShell';
import { Homepage } from './components/Homepage';
import { InviteScreen } from './components/InviteScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { SupportScreen } from './components/SupportScreen';
import { VerifyEmailScreen } from './components/VerifyEmailScreen';
import { WalrusLoader } from './components/WalrusLoader';
import { isDesktopApp } from './lib/platform';

/**
 * Davet bağlantısı dışında tek ekranlı bir uygulama olduğu için router
 * kullanmıyoruz: tek bir yol kontrolü, bir kütüphane bağımlılığından ucuz.
 * Faz 1.5'te derin bağlantı (kanala/mesaja atlama) gerekirse router gelir.
 *
 * Segment davet kodu (`9bKj4axx`) OLABİLECEĞİ GİBİ sunucu adı da olabilir
 * (`/davet/Deneme%20Sunucu`) — ikisi burada AYRIŞTIRILMAZ, tek bir metin
 * olarak `InviteScreen`'e verilir; kod mu ad mı olduğuna sunucuya sorarak
 * o karar verir. Eskiden yalnızca `[A-Za-z0-9_-]{4,12}` kabul edilirdi;
 * boşluklu/Türkçe karakterli ya da 12 karakteri aşan sunucu adları hiç
 * yakalanmıyor, path sessizce normal uygulamaya düşüyordu.
 */
function inviteTokenFromPath(): string | null {
  const match = /^\/(?:davet|invite)\/([^/]+)\/?$/.exec(location.pathname);
  const segment = match?.[1];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment).trim() || null;
  } catch {
    return null; // Bozuk yüzde kaçışı (ör. tek başına "%").
  }
}

/**
 * `tuscord.com` kök yolu, giriş yapmamış ziyaretçiyi artık doğrudan giriş
 * ekranıyla karşılamıyor — önce discord.com tarzı bir açılış sayfası var
 * (bkz. Homepage.tsx). `/login`'e (ya da TR eşdeğerine) gelen istek giriş
 * ekranını ister; bu, açılış sayfasındaki "Giriş Yap" / "Tarayıcıda Aç"
 * butonlarının gittiği yer.
 */
function wantsAuthScreen(): boolean {
  return /^\/(login|giris|register|kaydol)\/?$/.test(location.pathname);
}

/**
 * Parola sıfırlama e-postasındaki bağlantı buraya düşer (bkz. server
 * auth.ts: `${WEB_ORIGIN}/parola-sifirla?token=...`). Giriş yapmış olsan
 * bile çalışır — sunucu başarılı sıfırlamada zaten tüm oturumları düşürüyor.
 */
function resetTokenFromUrl(): string | null {
  if (!/^\/parola-sifirla\/?$/.test(location.pathname)) return null;
  return new URLSearchParams(location.search).get('token');
}

/**
 * Kayıt doğrulama e-postasındaki bağlantı buraya düşer (bkz. server
 * auth.ts: `${WEB_ORIGIN}/dogrula?token=...`). Giriş yapmış olsan bile
 * çalışır — token kendi başına doğrulamayı yapar, oturuma bağlı değil.
 */
function verifyTokenFromUrl(): string | null {
  if (!/^\/dogrula\/?$/.test(location.pathname)) return null;
  return new URLSearchParams(location.search).get('token');
}

/**
 * Destek e-postalarındaki ("Destek talebi aç" / "Destek sayfasına git")
 * bağlantı buraya düşer (bkz. server mail.ts suspensionMail/ticketReplyMail).
 * Giriş yapmış/yapmamış fark etmez — ticket oturumsuz gönderilebilir.
 */
function wantsSupportScreen(): boolean {
  return /^\/destek\/?$/.test(location.pathname);
}

/**
 * Bot davet linki: `/bot-ekle/<applicationId>?permissions=<bitfield>` (bkz.
 * DeveloperPortal'daki link üreteci). Giriş şart — davet ekranından farklı
 * olarak burada anonim önizleme yok, doğrudan giriş isteniyor (bkz. render'daki
 * showAuth dallanması).
 */
/**
 * Geçici admin raporlama sayfası (bkz. AdminStats.tsx). Erişim sınırı asıl
 * olarak sunucudadır (`/admin/stats/daily` isAdmin değilse 404 döner);
 * burada yalnızca yol eşleşmesine bakılır, yetki kontrolü render sırasında.
 */
function wantsAdminStats(): boolean {
  return /^\/admin\/rapor\/?$/.test(location.pathname);
}

function botInviteFromUrl(): { applicationId: string; permissions: bigint } | null {
  const match = /^\/bot-ekle\/(\d+)\/?$/.exec(location.pathname);
  const applicationId = match?.[1];
  if (!applicationId) return null;
  const raw = new URLSearchParams(location.search).get('permissions') ?? '0';
  let permissions: bigint;
  try {
    permissions = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  } catch {
    permissions = 0n;
  }
  return { applicationId, permissions };
}

export function App() {
  const { t } = useTranslation();
  const user = useStore((state) => state.user);
  const setUser = useStore((state) => state.setUser);
  const [checking, setChecking] = useState(true);
  const [inviteToken, setInviteToken] = useState<string | null>(() => inviteTokenFromPath());
  /** Davet ekranındaki "Giriş yap ve katıl" ile buraya geldik mi (bkz. InviteScreen.tsx autoJoin). */
  const [inviteWantsAuth, setInviteWantsAuth] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(() => resetTokenFromUrl());
  const [verifyToken, setVerifyToken] = useState<string | null>(() => verifyTokenFromUrl());
  const [showSupport, setShowSupport] = useState(() => wantsSupportScreen());
  /** Askıya alınmış bir hesap giriş denediğinde dolar (bkz. AuthScreen onSuspended). */
  const [suspendedInfo, setSuspendedInfo] = useState<{ email: string; until: string } | null>(null);
  const [botInvite, setBotInvite] = useState(() => botInviteFromUrl());
  const [showAdminStats, setShowAdminStats] = useState(() => wantsAdminStats());
  /**
   * Masaüstü uygulamasında açılış sayfası hiç gösterilmez — orada zaten
   * içindesin, "Windows için indir" sunmak anlamsız (bkz. kullanıcı raporu).
   * Discord'un kendi masaüstü istemcisi de aynı şekilde davranıyor: pencere
   * açılır açılmaz doğrudan giriş ekranı.
   */
  const [showAuth, setShowAuth] = useState(() => wantsAuthScreen() || isDesktopApp());

  // Açılışta cookie geçerli mi: geçerliyse giriş ekranını hiç gösterme.
  useEffect(() => {
    void api
      .get<{ user: SelfUser }>('/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, [setUser]);

  // Geri/ileri tuşları davet ekranından ve giriş ekranından çıkışı da yönetsin.
  useEffect(() => {
    const onPopState = () => {
      setInviteToken(inviteTokenFromPath());
      setResetToken(resetTokenFromUrl());
      setVerifyToken(verifyTokenFromUrl());
      setShowSupport(wantsSupportScreen());
      setBotInvite(botInviteFromUrl());
      setShowAdminStats(wantsAdminStats());
      setShowAuth(wantsAuthScreen() || isDesktopApp());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useGateway(user !== null);

  function leaveInvite() {
    history.pushState({}, '', '/');
    setInviteToken(null);
    setInviteWantsAuth(false);
  }

  /** Açılış sayfasındaki iki buton da buraya çıkıyor — ikisi de aynı hedefe gider. */
  function enterAuthScreen() {
    if (!wantsAuthScreen()) history.pushState({}, '', '/login');
    setShowAuth(true);
  }

  /** Giriş başarılı: adres çubuğunu köke döndür, kullanıcıyı ata. */
  function handleAuthenticated(authedUser: SelfUser) {
    if (wantsAuthScreen()) history.pushState({}, '', '/');
    setUser(authedUser);
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center">
        <WalrusLoader label={t('common.loading')} />
      </div>
    );
  }

  if (resetToken) {
    return (
      <ResetPasswordScreen
        token={resetToken}
        requireCurrentPassword={user !== null}
        onDone={() => {
          // Parola değişince sunucu TÜM oturumları düşürür (bkz. auth.ts) —
          // kendi cihazımız da dahil. Yerel durumu da temizlemezsek eski
          // (artık geçersiz) oturumla ChatShell'e düşüp ilk API çağrısında
          // 401 patlardı.
          setUser(null);
          history.pushState({}, '', '/login');
          setResetToken(null);
          setShowAuth(true);
        }}
      />
    );
  }

  if (suspendedInfo) {
    return (
      <SupportScreen
        initialEmail={suspendedInfo.email}
        suspendedUntil={suspendedInfo.until}
        onClose={() => setSuspendedInfo(null)}
      />
    );
  }

  if (showSupport) {
    return (
      <SupportScreen
        initialEmail={user?.email}
        onClose={() => {
          if (wantsSupportScreen()) history.pushState({}, '', '/');
          setShowSupport(false);
        }}
      />
    );
  }

  if (verifyToken) {
    return (
      <VerifyEmailScreen
        token={verifyToken}
        onLogin={() => {
          history.pushState({}, '', '/login');
          setVerifyToken(null);
          setShowAuth(true);
        }}
      />
    );
  }

  if (botInvite) {
    if (!user) {
      return <AuthScreen onAuthenticated={(authedUser) => setUser(authedUser)} />;
    }
    return (
      <BotInviteScreen
        applicationId={botInvite.applicationId}
        permissions={botInvite.permissions}
        onCancel={() => {
          history.pushState({}, '', '/');
          setBotInvite(null);
        }}
        onAdded={(guildId) => {
          history.pushState({}, '', '/');
          setBotInvite(null);
          useStore.getState().setPendingActiveGuild(guildId);
        }}
      />
    );
  }

  if (showAdminStats) {
    if (!user) return <AuthScreen onAuthenticated={handleAuthenticated} />;
    // Admin değilse sayfanın varlığını belli etmeden ana uygulamaya düş —
    // sunucu tarafındaki admin uçlarıyla AYNI ilke (bkz. routes/admin.ts:
    // "admin uçlarının varlığı sıradan kullanıcıya sızmasın").
    if (!user.isAdmin) {
      history.replaceState({}, '', '/');
      return <ChatShell />;
    }
    return (
      <AdminStats
        onBack={() => {
          history.pushState({}, '', '/');
          setShowAdminStats(false);
        }}
      />
    );
  }

  if (inviteToken) {
    // "Giriş yap ve katıl"a basıldıysa giriş ekranını GÖSTER — davet
    // önizlemesi yerine. Giriş başarılı olunca `user` dolar, bir alttaki
    // dala düşüp AYNI davetle (autoJoin=true) InviteScreen'e döneriz.
    if (!user && inviteWantsAuth) {
      return <AuthScreen onAuthenticated={(authedUser) => setUser(authedUser)} />;
    }
    return (
      <InviteScreen
        token={inviteToken}
        authenticated={user !== null}
        autoJoin={inviteWantsAuth}
        onRequestLogin={() => setInviteWantsAuth(true)}
        onCancel={leaveInvite}
        onJoined={(guildId) => {
          leaveInvite();
          // Katılma sonrası sunucu GUILD_CREATE yayınlıyor; bu işaret,
          // olay gelir gelmez sunucunun açılmasını sağlar.
          useStore.getState().setPendingActiveGuild(guildId);
        }}
      />
    );
  }

  if (!user) {
    if (showAuth) {
      return (
        <AuthScreen
          onAuthenticated={handleAuthenticated}
          onSuspended={(email, until) => setSuspendedInfo({ email, until })}
        />
      );
    }
    return <Homepage onEnter={enterAuthScreen} />;
  }

  return <ChatShell />;
}
