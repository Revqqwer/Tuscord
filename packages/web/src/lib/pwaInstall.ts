/**
 * "Alternatif indirme" — Homepage.tsx'teki .exe indirmesine ek olarak,
 * tarayıcının kendi PWA yükleme akışı (SmartScreen uyarısı yok, imza
 * gerektirmiyor, bkz. manifest.webmanifest + sw.js). Chrome/Edge sayfayı
 * "yüklenebilir" bulursa `beforeinstallprompt` olayını ateşler — bunu en
 * baştan (modül yüklenir yüklenmez) dinlemek şart, geç kayıt olursa olay
 * kaçırılabilir.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  notify();
});

export function subscribeInstallPrompt(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function isInstallPromptAvailable(): boolean {
  return deferredPrompt !== null;
}

export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  // Aynı olay iki kez kullanılamaz — hemen temizle, sonucu bekleme gerekmez.
  deferredPrompt = null;
  notify();
  await prompt.prompt();
  await prompt.userChoice;
}
