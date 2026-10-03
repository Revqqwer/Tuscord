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

let registeredToken: string | null = null;

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
