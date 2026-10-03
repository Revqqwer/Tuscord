/**
 * Service worker — çevrimdışı kabuk.
 *
 * Strateji, içerik tipine göre ayrılıyor:
 *  - Gezinme (HTML): önce ağ. Yeni sürüm çıktığında kullanıcı eski kabukta
 *    takılı kalmasın; ağ yoksa önbellekteki kabuk gösterilir.
 *  - Statik varlıklar (JS/CSS/ikon): önce önbellek. Vite dosya adına hash
 *    koyduğu için içerik değişince URL de değişir, bayat sürüm riski yok.
 *  - API ve gateway: ASLA önbelleğe alınmaz. Bayat mesaj/izin göstermek,
 *    çevrimdışı çalışmamaktan daha kötü.
 *
 * Not: sohbet geçmişi çevrimdışı tutulmuyor. Faz 1'in hedefi "ana ekrana
 * eklenebilen uygulama"; gerçek çevrimdışı okuma ayrı bir iş.
 */

const VERSION = 'tuscord-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // Yeni sürüm hemen devreye girsin, bir sonraki açılışı beklemesin.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Canlı veri asla önbellekten servis edilmez.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/gateway')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Yalnızca başarılı ve aynı origin yanıtlar saklanır.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/**
 * Web Push (VAPID) — sekme/PWA tamamen KAPALIYKEN de burası tetiklenir
 * (bkz. services/webPush.ts, sunucu tarafı gönderim). Payload biçimi
 * `sendWebPushToUsers`'ın gönderdiğiyle birebir: { title, body, data }.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Tuscord', {
      body: payload.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: payload.data ?? {},
      tag: payload.data?.channelId, // aynı kanaldan art arda gelenler tek bildirimde birikir
    }),
  );
});

/**
 * Bildirime tıklanınca: aynı origin'de zaten açık bir sekme/pencere varsa
 * ona odaklan (yeni sekme açıp kafa karıştırmasın); yoksa yeni aç. Hangi
 * kanala gidileceği (data.channelId/guildId) şu an istemci tarafında ayrı
 * okunmuyor — odaklanma sonrası kullanıcı zaten roster'da görür; kanala
 * otomatik atlama Faz 2 kapsamı.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    }),
  );
});
