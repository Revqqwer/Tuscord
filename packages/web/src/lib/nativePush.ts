/**
 * iOS App Store kabuğu (Capacitor) için native push kaydı.
 *
 * Sıradan tarayıcıda/PWA'da `@capacitor/push-notifications` hiç import
 * edilmez (dinamik import + isCapacitorApp() koruması) — web build'i
 * bundan etkilenmesin, Web Push zaten webPush.ts ile ayrı yürüyor.
 *
 * Sunucu tarafı: bkz. routes/users.ts POST/DELETE /users/@me/push-tokens
 * ve services/apns.ts (Expo değil, doğrudan APNs).
 */
import { api } from './api';
import { isCapacitorApp } from './platform';
import { useStore } from '../store';

let registeredToken: string | null = null;
let listenersAttached = false;

/**
 * Bildirime dokunulunca ilgili kanala geç. Sunucu `channelId`/`guildId`'yi
 * bildirim verisine koyuyor (routes/messages.ts); DM'de guildId boştur (FCM
 * değerleri metne çevirdiği için "null"/"" da gelebilir).
 *
 * Uygulama bildirimden soğuk açıldıysa sunucu/kanal listesi henüz yüklenmemiş
 * olabilir — store'a abone olup hedef gelene kadar (en fazla 20 sn) bekleriz.
 */
function openFromNotification(data: Record<string, unknown> | undefined): void {
  const channelId = typeof data?.channelId === 'string' && data.channelId ? data.channelId : null;
  if (!channelId) return;
  const rawGuild = data?.guildId;
  const guildId = typeof rawGuild === 'string' && rawGuild && rawGuild !== 'null' ? rawGuild : null;

  const tryOpen = (): boolean => {
    const state = useStore.getState();
    if (guildId) {
      if (!state.guilds.has(guildId)) return false;
      state.setActive(guildId, channelId);
      return true;
    }
    if (!state.privateChannels.some((c) => c.id === channelId)) return false;
    state.openDMView(channelId);
    return true;
  };

  if (tryOpen()) return;
  const unsubscribe = useStore.subscribe(() => {
    if (tryOpen()) {
      unsubscribe();
      clearTimeout(timer);
    }
  });
  const timer = setTimeout(unsubscribe, 20_000);
}

export async function registerNativePush(): Promise<void> {
  if (!isCapacitorApp()) return;

  try {
    const [{ PushNotifications }, { Capacitor }] = await Promise.all([
      import('@capacitor/push-notifications'),
      import('@capacitor/core'),
    ]);

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return;

    const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios';

    PushNotifications.addListener('registration', (token) => {
      registeredToken = token.value;
      void api.post('/users/@me/push-tokens', { token: token.value, platform }).catch(() => undefined);
    });
    PushNotifications.addListener('registrationError', (error) => {
      console.error('[push] APNs kaydı başarısız', error);
    });

    if (!listenersAttached) {
      listenersAttached = true;
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        openFromNotification(action.notification.data as Record<string, unknown> | undefined);
      });
      // Uygulama öne gelince bildirim merkezindeki eski bildirimleri temizle —
      // kullanıcı zaten uygulamada, mesajları gördü.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void PushNotifications.removeAllDeliveredNotifications().catch(() => undefined);
        }
      });
    }
    void PushNotifications.removeAllDeliveredNotifications().catch(() => undefined);

    await PushNotifications.register();
  } catch (error) {
    console.error('[push] native push kurulamadı', error);
  }
}

/** Çıkış yapılırken çağrılır — cihaz artık bu hesaba bildirim almasın. */
export async function unregisterNativePush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await api.delete('/users/@me/push-tokens', { token }).catch(() => undefined);
}
