/**
 * Masaüstü uygulaması (Electron kabuğu, bkz. packages/desktop) içinde mi
 * çalışıyoruz — main.js kendi user agent'ına özel bir "TuscordDesktop/1.0"
 * imzası ekliyor, BUNU arıyoruz. Genel "Electron/" ibaresine GÜVENME:
 * Electron tabanlı başka tarayıcılar/araçlar da bunu taşıyabilir (canlı
 * testte tam olarak bu sorun yakalandı — test aracının kendi tarayıcı
 * penceresi de Electron tabanlıydı, "Electron/" kontrolü onu da masaüstü
 * uygulaması sanıp açılış sayfasını yanlışlıkla atlıyordu).
 *
 * Kullanım: App.tsx bunu, masaüstünde "tuscord.com'u indir" içeren açılış
 * sayfasını atlayıp doğrudan giriş ekranını göstermek için kullanıyor
 * (bkz. kullanıcı raporu: "desktop olmasına rağmen hala indirme linkini
 * sunan homepage açılıyor").
 */
export function isDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('TuscordDesktop/');
}
