/**
 * Web Push (VAPID) aboneliği — uygulama TAMAMEN KAPALIYKEN de bildirim
 * gösterebilmek için (bkz. public/sw.js 'push' olayı, services/webPush.ts
 * sunucu tarafı). ChatShell.tsx'teki mevcut `Notification.requestPermission`
 * akışının hemen ardından çağrılır — izin zaten kullanıcı jestiyle alındı,
 * abonelik için ayrıca jest gerekmiyor.
 */
import { api } from './api';

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Sessizce dener — özellik kapalıysa (VAPID ayarlı değil, `/push/vapid-
 * public-key` 404 döner), tarayıcı desteklemiyorsa ya da kullanıcı izin
 * vermediyse hiçbir şey yapmaz. Hata fırlatmaz: bu bir "nice to have",
 * uygulamanın geri kalanını bloklamamalı.
 */
export async function subscribeWebPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    const { publicKey } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS'in Uint8Array<ArrayBufferLike> ile BufferSource'un beklediği
        // Uint8Array<ArrayBuffer> arasındaki katı ayrımı — runtime'da sorun
        // yok, PushManager her ikisini de kabul ediyor.
        applicationServerKey: base64UrlToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;

    await api.post('/users/@me/web-push-subscription', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch {
    // Sessiz geç — bkz. dosya başı yorumu.
  }
}
