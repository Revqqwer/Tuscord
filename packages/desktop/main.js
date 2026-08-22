/**
 * Tuscord masaüstü uygulaması — ana süreç.
 *
 * BİLEREK ayrı bir arayüz kodu YOK: bu, tuscord.com'u yükleyen ince bir
 * Electron kabuğu. Web arayüzü değiştikçe masaüstü uygulaması OTOMATİK
 * güncel kalır — ayrı bir kod tabanını senkron tutmaya gerek yok (bkz.
 * kullanıcı isteği: "web arayüzüyle desktop app ön yüzler aynı olsun").
 */

const path = require('node:path');
const { app, BrowserWindow, Menu, Tray, shell, desktopCapturer, ipcMain } = require('electron');

const APP_URL = 'https://tuscord.com';
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

/** Ana pencere referansı — tray menüsünden geri açabilmek için modül seviyesinde. */
let mainWindow = null;
let tray = null;
/**
 * Çarpıya basmak PENCEREYİ gizler, uygulamayı KAPATMAZ (bkz. kullanıcı
 * isteği: "Discord/WhatsApp gibi arka planda çalışsın, malware gibi
 * algılama"). Gerçek çıkış yalnızca tray menüsündeki "Çıkış"tan — o zaman
 * bu bayrak true olur ve pencerenin 'close' dinleyicisi engellemeyi bırakır.
 */
let isQuitting = false;

/** Yalnızca tuscord.com içindeki gezinmelere izin ver — başka her şey (dış
 * bağlantılar, hukuki sayfalar dahil) sistem tarayıcısında açılsın. Bu hem
 * güvenlik hijyeni (uzak içerik rastgele pencere açamaz/sızdıramaz) hem de
 * beklenen davranış (bir bağlantıya tıklamak uygulamanın İÇİNDE değil,
 * normal tarayıcıda açılmalı). */
function isAppUrl(url) {
  try {
    return new URL(url).origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Mikrofon/ekran paylaşımı (WebRTC) için medya izinleri gerekiyor —
      // bkz. aşağıdaki setPermissionRequestHandler.
    },
  });

  // Bariz bir user agent imzası — web arayüzü bunu görüp masaüstü kabuğunda
  // olduğunu anlıyor (bkz. lib/platform.ts isDesktopApp). BİLEREK genel
  // "Electron/" ibaresine GÜVENİLMİYOR: Electron tabanlı BAŞKA tarayıcılar/
  // araçlar da UA'sında bunu taşıyabilir (canlı testte tam olarak bu sorun
  // yakalandı — test aracının kendisi Electron tabanlıydı) ve o durumda
  // yanlışlıkla açılış sayfası atlanırdı.
  win.webContents.userAgent = `${win.webContents.userAgent} TuscordDesktop/1.0`;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // Çarpıya basınca gerçekten kapatma — gizle. Bildirimler/sesli kanal gibi
  // şeylerin arka planda çalışmaya devam etmesi için (bkz. dosya başı yorumu).
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  // Mikrofon/kamera/ekran paylaşımı izinleri — ses kanalları ve ekran
  // paylaşımı için gerekli (bkz. lib/voice.ts getUserMedia/getDisplayMedia).
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'notifications', 'display-capture'].includes(permission));
  });

  /**
   * Ekran paylaşımı seçici — TARAYICIDA `getDisplayMedia()` otomatik olarak
   * bir seçim penceresi açar, ELECTRON'DA bunu BİZ kurmazsak hiçbir şey
   * olmaz, `getDisplayMedia()` sessizce başarısız olur (bkz. kullanıcı
   * raporu: "ekran paylaşımı çalışmıyor"). `useSystemPicker` YALNIZCA
   * macOS 15+'ta gerçek bir OS seçicisi gösteriyor — Windows'ta bu seçenek
   * sessizce YOK SAYILIYOR ve handler her zaman çalışıyor, bu yüzden ilk
   * sürümde kullanıcıya soru sormadan doğrudan birincil ekranı paylaşmış
   * olduk (bkz. kullanıcı raporu: "screen seçemiyorum anında mevcut ekranı
   * paylaşıyor"). Bu yüzden kendi seçici penceremizi (picker.html) açıp
   * kullanıcının ekran/pencere arasından seçim yapmasını bekliyoruz.
   */
  win.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    openScreenPicker(win)
      .then((source) => {
        callback(source ? { video: source, audio: 'loopback' } : {});
      })
      .catch(() => callback({}));
  });

  void win.loadURL(APP_URL);
  mainWindow = win;
  return win;
}

/**
 * Sistem tepsisi ikonu — Discord/WhatsApp'ta olduğu gibi, pencere
 * kapatılınca (gizlenince) uygulamaya geri dönüş yeri. Tıklamak pencereyi
 * geri açar; sağ tık menüsündeki "Çıkış" GERÇEK kapanışı tetikler.
 */
function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('Tuscord');

  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Tuscord'u Aç", click: showWindow },
      { type: 'separator' },
      {
        label: 'Çıkış',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  // Tek tık (Windows'ta standart davranış) de pencereyi öne getirsin —
  // sağ tık menüsünü açmaya zorlamayalım.
  tray.on('click', showWindow);
}

/** O an açık seçici penceresinin seçim/iptal sonucunu bekleyen çözümleyici —
 * aynı anda yalnızca bir ekran paylaşımı isteği olabileceği için tek bir
 * modül seviyesi değişken yeterli. */
let activePickerResolve = null;

ipcMain.on('picker:select', (_event, sourceId) => {
  if (activePickerResolve) activePickerResolve(sourceId);
});
ipcMain.on('picker:cancel', () => {
  if (activePickerResolve) activePickerResolve(null);
});

/** Ekran/pencere seçim penceresini açar, kullanıcı seçim yapana veya
 * pencereyi kapatana kadar bekleyen bir promise döner. */
function openScreenPicker(parentWin) {
  return new Promise((resolve) => {
    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 240, height: 150 } })
      .then((sources) => {
        const picker = new BrowserWindow({
          width: 420,
          height: 480,
          parent: parentWin,
          modal: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          autoHideMenuBar: true,
          backgroundColor: '#111318',
          icon: ICON_PATH,
          webPreferences: {
            preload: path.join(__dirname, 'picker-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });

        let settled = false;
        activePickerResolve = (sourceId) => {
          if (settled) return;
          settled = true;
          activePickerResolve = null;
          resolve(sources.find((s) => s.id === sourceId) ?? null);
          if (!picker.isDestroyed()) picker.close();
        };

        picker.on('closed', () => {
          if (settled) return;
          settled = true;
          activePickerResolve = null;
          resolve(null);
        });

        picker.loadFile(path.join(__dirname, 'picker.html')).then(() => {
          picker.webContents.send(
            'picker:sources',
            sources.map((s) => ({
              id: s.id,
              name: s.name,
              thumbnail: s.thumbnail.toDataURL(),
              kind: s.id.startsWith('screen:') ? 'screen' : 'window',
            })),
          );
        });
      })
      .catch(() => resolve(null));
  });
}

/**
 * PC açılışında otomatik başlat (bkz. kullanıcı isteği). Yalnızca paketlenmiş
 * (kurulum yapılmış) uygulamada anlamlı — `electron .` ile geliştirme
 * modunda çalıştırıldığında Windows'un başlangıç kaydına node.exe/electron.exe
 * yazılırdı, bu da kurulu olmayan bir yolu başlatmaya çalışırdı.
 * `app.isPackaged` bu ayrımı yapıyor.
 */
function enableAutoLaunch() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.tuscord.desktop');
  Menu.setApplicationMenu(null);
  enableAutoLaunch();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Pencere artık kapanınca DEĞİL, tray'den "Çıkış" seçilince kapanıyor (bkz.
// win.on('close') ve createTray) — bu olay normal akışta neredeyse hiç
// tetiklenmez, yalnızca gerçek çıkışın son adımı olarak kalıyor.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Sistem kapanışı/oturum kapatma gibi Electron dışından gelen çıkış
// isteklerinde de pencere 'close' dinleyicisi engellemeye devam etmesin.
app.on('before-quit', () => {
  isQuitting = true;
});
