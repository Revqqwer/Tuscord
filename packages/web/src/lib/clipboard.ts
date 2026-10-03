/**
 * Panoya kopyalama — masaüstü uygulamasında (bkz. packages/desktop
 * preload.js) native Electron köprüsünü, web'de standart Clipboard API'yi
 * kullanır.
 *
 * Neden: `navigator.clipboard.writeText()` Electron'da pencere o an OS
 * odağında değilse `NotAllowedError` ile SESSİZCE başarısız olabiliyor
 * (kullanıcı raporu: davet linki modalında "Kopyala" bazen hiçbir şey
 * yapmıyordu). Electron'un ana süreçteki `clipboard` modülü bu web
 * güvenlik kısıtına tabi değil.
 */

interface TuscordDesktopBridge {
  copyToClipboard: (text: string) => Promise<void>;
}

declare global {
  interface Window {
    tuscordDesktop?: TuscordDesktopBridge;
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (window.tuscordDesktop) {
    await window.tuscordDesktop.copyToClipboard(text);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
