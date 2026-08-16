import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelfUser } from '@tuscord/shared';
import { api } from './lib/api';
import { useStore } from './store';
import { useGateway } from './hooks/useGateway';
import { AuthScreen } from './components/AuthScreen';
import { ChatShell } from './components/ChatShell';
import { Homepage } from './components/Homepage';
import { InviteScreen } from './components/InviteScreen';
import { WalrusLoader } from './components/WalrusLoader';

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

export function App() {
  const { t } = useTranslation();
  const user = useStore((state) => state.user);
  const setUser = useStore((state) => state.setUser);
  const [checking, setChecking] = useState(true);
  const [inviteToken, setInviteToken] = useState<string | null>(() => inviteTokenFromPath());
  const [showAuth, setShowAuth] = useState(() => wantsAuthScreen());

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
      setShowAuth(wantsAuthScreen());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useGateway(user !== null);

  function leaveInvite() {
    history.pushState({}, '', '/');
    setInviteToken(null);
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

  if (inviteToken) {
    return (
      <InviteScreen
        token={inviteToken}
        authenticated={user !== null}
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
    if (showAuth) return <AuthScreen onAuthenticated={handleAuthenticated} />;
    return <Homepage onEnter={enterAuthScreen} />;
  }

  return <ChatShell />;
}
