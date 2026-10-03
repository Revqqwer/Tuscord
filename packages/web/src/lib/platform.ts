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

/**
 * iPhone/iPad — Homepage.tsx'in "Uygulamayı indir" akışı için. iOS Safari
 * PWA yüklemesini programatik tetikleyemiyor (`beforeinstallprompt` yok);
 * tek yol kullanıcıya Paylaş → Ana Ekrana Ekle adımlarını göstermek.
 * `MSStream` kontrolü: eski IE'nin UA'sında "iPhone" geçebiliyordu, o
 * false-positive'i eler (artık pratik önemi yok ama zararsız).
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(navigator as unknown as { MSStream?: unknown }).MSStream
  );
}

/** Android — Chrome'un native `beforeinstallprompt` akışını tetikleyebiliriz. */
export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
}

/**
 * iOS App Store kabuğu (Capacitor) içinde mi çalışıyoruz. Capacitor kendi
 * `window.Capacitor` köprüsünü enjekte eder; sıradan tarayıcıda/PWA'da bu
 * hiç yok — push kaydı gibi native-özel akışları bununla koruyoruz.
 */
export function isCapacitorApp(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
  );
}

/** PWA zaten yüklenip bağımsız (standalone) modda mı açılmış. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari standalone modu display-mode yerine bunu kullanıyor.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
