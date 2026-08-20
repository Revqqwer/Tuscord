# Tuscord

Discord yapısında topluluk sohbet platformu. Türkiye'den VPN'siz erişilebilir,
kendi markası olan, sıfırdan yazılmış.

Kapsam ve kararlar: [PROJE-SPEC.md](../PROJE-SPEC.md)

**Durum:** **Canlı — [tuscord.com](https://tuscord.com)**. Faz 1 (metin),
Faz 2 (sesli sohbet) ve Faz 3 (ekran paylaşımı) tamamlandı. Gerçek ağlarda
(farklı operatörler) gecikme testi devam ediyor.

**Öne çıkan özellikler:** sunucu/kanal/rol + izin motoru · metin sohbeti
(markdown, düzenle/yanıtla/tepki, @etiketleme, dosya/görsel) · DM · arkadaş
sistemi (tag ile) · mesaj arama · sağ tık menüleri · sunucu ikon/banner ·
kanal izin overwrite ekranı · platform admin · **sesli kanallar** (mesh P2P) ·
**ekran paylaşımı** (kanaldaki herkes) · moderasyon paneli · PWA · TR/EN.

## Alınan kararlar

| Karar | Değer |
|---|---|
| İsim | **Tuscord** |
| Domain | **tuscord.com** (GoDaddy → Cloudflare nameserver) |
| Barındırma (şimdilik) | Ev makinesi + **Cloudflare Tunnel** (genel IP/açık port gerektirmez, ücretsiz). Ölçeklenince TR VPS'e taşınır. |
| Ses/ekran taşıma | **Mesh P2P WebRTC** — medya sunucusu YOK. Sinyalleşme gateway üzerinden, NAT geçişi public STUN. LiveKit değil: ev+tunnel altyapısında LiveKit medyası çalışmaz. |
| E-posta | **Amazon SES** SMTP (Gmail → Brevo → SES; DMARC p=reject) |
| Trafik kaydı saklama | 365 gün, otomatik silme (`TRAFFIC_LOG_RETENTION_DAYS`) |
| Ana renk | `#14b8a6` turkuaz — Discord'un `#5865F2`'sinden belirgin farklı |

> **Marka uyarısı:** Domain almadan önce TÜRKPATENT ve EUIPO'da "Tuscord"
> araması yap. Revolt projesi bu adımı atladığı için ihtarname aldı ve
> Ekim 2025'te Stoat olmak zorunda kaldı.

## Yapı

```
packages/
  shared/   izin motoru, snowflake, API tipleri, gateway protokolü  (istemci+sunucu ortak)
  server/   Fastify REST + ws gateway + Drizzle/Postgres + mesh sinyalleşme
  web/      React + Vite + Tailwind + WebRTC mesh (lib/voice.ts)
docker/     Caddyfile(.tunnel), compose.prod.yml + compose.tunnel.yml, sunucu imajı
```

`shared` paketi kasıtlı olarak ortak: izin hesabı istemcide ve sunucuda
**aynı fonksiyonla** yapılır. İstemci tarafı yalnızca arayüz içindir
(yazamayacağın kanalda kutuyu kapatmak); güvenlik sınırı sunucudadır.

## Kurulum

Gereken: Node 22+, Docker.

```bash
cp .env.example .env
```

`.env` içinde `SESSION_SECRET` üret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sonra:

```bash
docker compose up -d
npm install
npm run db:migrate
npm run seed --workspace=@tuscord/server
```

İki terminal:

```bash
npm run dev --workspace=@tuscord/server
```

```bash
npm run dev --workspace=@tuscord/web
```

Arayüz: http://localhost:5174 — Vite, `/api` ve `/gateway` isteklerini
3001'e proxy'ler. Aynı origin şart: oturum cookie'si `HttpOnly` + `SameSite=lax`.

Seed giriş bilgileri: `hakan@tuscord.local` / `tuscord123`

### Telefondan test

Vite `host: true` ile tüm arayüzleri dinliyor. Telefon **aynı Wi-Fi'de**
olmalı; bilgisayarın yerel IP'sini bul (`ipconfig` → IPv4) ve telefondan
`http://<ip>:5174` aç. Proxy sayesinde API ve gateway aynı origin'den gelir,
cookie host-only olduğu için IP'den erişimde de çalışır.

İlk denemede Windows Güvenlik Duvarı 5174 portunu sorabilir — **Özel ağlarda
izin ver**. Sormazsa yönetici PowerShell'de:

```powershell
New-NetFirewallRule -DisplayName "Tuscord Dev 5174" -Direction Inbound -LocalPort 5174 -Protocol TCP -Action Allow -Profile Private
```

## Testler

```bash
npm test
```

Spec zorunlu kılıyor: izin hesaplama fonksiyonu ve hız sınırlayıcı için
birim testleri. Şu an 124 test (izin 41, markdown 33, dosya tipi 20,
hız sınırı 14, içerik tarama 5, snowflake 11). **İzin motorunu değiştirirken
testleri önce yaz** — Discord klonlarının en sık patladığı yer burası.

Not: testler `shared` ve `server` paketlerinde koşuyor. `web` paketinde
vitest ayağa kalkmıyor (vite 6 / vitest 2 uyumsuzluğu), bu yüzden saf
mantık `shared`'e konuluyor — markdown ayrıştırıcı orada.

## Mimarinin kritik noktaları

**İzin motoru** (`packages/shared/src/permissions.ts`) tek saf fonksiyondur.
Sunucuda hiçbir rota elle `role.permissions & X` yapmaz; her yetkilendirme
`services/permissions.ts` üzerinden `computePermissions()`'a gider.
Sıra: sahip → @everyone → roller (OR) → administrator → kanal overwrite'ları
(@everyone → rol deny'ları → rol allow'ları → üye) → timeout.

**Snowflake ID'ler.** Her süreç farklı `SNOWFLAKE_WORKER_ID` ile başlamalı.
Aynı worker id ile iki süreç çakışan ID üretir.

**Sayfalama her zaman kürsörle.** `OFFSET` yok — aktif bir kanalda kullanıcıya
mesaj atlatır.

**Gizli kanal sızdırmama.** Görme izni olmayan kanal `404` döner (403 değil),
gateway olayları izin süzgecinden geçer, arama yalnızca görünür kanallarda çalışır.

**Yetki yükseltmeye kapalı.** Sahip olmadığın izni bir role veremezsin
(`cannot_grant_permissions`), kendi en yüksek rolünden yüksek veya eşit
konumdaki rolü/üyeyi yönetemezsin (`role_hierarchy`), sunucu sahibi
dokunulmazdır. Dördü de uçtan uca test edildi.

## Dağıtım

Şu an **sıfır maliyetli** çalışıyor: ev makinesinde Docker Compose + Caddy,
öne **Cloudflare Tunnel** (`cloudflared` konteyneri). Genel IP veya açık port
gerekmez — tünel `caddy:80`'e bağlanır, `tuscord.com` Cloudflare Zero Trust
üzerinden yayınlanır. R2 gerekmez; dosyalar kalıcı volume'de durur.

**Canlı stack (Cloudflare Tunnel):**

```bash
# .env hazırla: NODE_ENV=production, COOKIE_SECURE=true, SESSION_SECRET (32+ bayt),
# POSTGRES_PASSWORD, WEB_ORIGIN=https://tuscord.com, COOKIE_DOMAIN=tuscord.com,
# TUNNEL_TOKEN=<Cloudflare Zero Trust tünel token'ı>

docker compose --env-file .env -f docker/compose.tunnel.yml up -d --build

# Şemayı kur (derlenmiş dist çalışır, src DEĞİL)
docker compose --env-file .env -f docker/compose.tunnel.yml \
  exec -T api node packages/server/dist/db/migrate.js
```

> `--env-file .env` şart: compose dosyası `docker/` alt dizininde, `.env` kökte;
> bayrak olmadan `${POSTGRES_PASSWORD}` boş gelir. API `3001` portunu dinler.

**Alternatif — VPS + açık HTTPS:** genel IP'li bir sunucuda
`docker/compose.prod.yml` + `docker/Caddyfile` (içindeki `ALAN_ADI`'nı değiştir)
kullanılır; Cloudflare önde DNS/CDN/DDoS/WAF sağlar. Mesh P2P ses/ekran için
**ekstra port açmaya gerek yok** — medya tarayıcılar arası doğrudan gider,
NAT geçişi STUN ile yapılır. (Katı NAT arkasındaki kullanıcılar için ileride
coturn/TURN ya da LiveKit SFU eklenebilir; UDP portları o zaman gerekir.)

**Docker Desktop notu:** ara sıra kendiliğinden durur ve `tuscord.com` düşer;
`Docker Desktop.exe` yeniden başlatılıp stack `up -d` ile geri gelir.

## Sesli sohbet ve ekran paylaşımı (Faz 2–3)

**Mimari: mesh P2P WebRTC**, medya sunucusu yok. Ses kanalındaki her katılımcı
diğer herkese doğrudan bir `RTCPeerConnection` açar; sinyalleşme (SDP/ICE)
mevcut gateway WebSocket'i üzerinden taşınır (`VOICE_STATE` / `VOICE_SIGNAL`
opcode'ları, `VOICE_STATE_UPDATE` olayı), NAT geçişi için ücretsiz public STUN
kullanılır. Sunucu yalnızca "kim hangi kanalda"yı bellekte tutar ve sinyali
hedefe iletir — medya sunucudan geçmez, CPU maliyeti ~sıfır.

- **Sesli kanal:** `+` ile metin/sesli seç, tıklayınca katıl. Kanal altında
  canlı katılımcı listesi, konuşanın avatarında yeşil halka, mute/deafen
  ikonları.
- **Kontrol çubuğu:** alt kullanıcı çubuğunun üstünde sustur / kulaklık kapat /
  ekran paylaş / ayrıl.
- **Ekran paylaşımı:** kanaldaki **herkes** paylaşabilir (`getDisplayMedia`).
  Video izi tüm eşlere eklenir; bağlantı **perfect negotiation** ile yeniden
  müzakere edilir (cam kırılmasına/glare'a dayanıklı, küçük id impolite).
  İzleyicide sahne ekranın çoğunu kaplar, tam ekran düğmesi var. Chrome'da
  sekme/sistem sesi de paylaşılabilir.
- **Yeniden bağlanma:** gateway kopup dönünce eşler otomatik yeniden kurulur.

> **Sınır:** mesh ~4–6 kişiye kadar iyidir (herkes N−1 akış yükler; ekran
> paylaşımı yükü artırır). Katı NAT / kurumsal güvenlik duvarı arkasındaki
> kullanıcılar TURN olmadan bağlanamayabilir. Büyük odalar veya garantili
> bağlantı gerekince coturn (TURN) ya da LiveKit SFU'ya yükseltilir — taşıma
> katmanı bunun için soyut tutuldu.

> **Zorunlu test (spec):** gerçek operatörlerde (Türk Telekom, Superonline,
> Vodafone, mobil veri) gecikme ölçümü. Bu adım atlanırsa Faz 2–3 çöpe gider.

## Dosya yükleme

Depolama soyutlanmış (`services/storage.ts`): `.env`'de R2 anahtarları varsa
R2, yoksa yerel disk (`packages/server/var/uploads`). Kod değişmeden geçiş yapar.

Güvenlik: tip doğrulaması **magic byte** ile beyaz liste üzerinden yapılır
(uzantıya bakılmaz), nesne anahtarı 128 bit rastgele, dosyalar
`Content-Disposition: attachment` ile sunulur. SVG kabul edilmez — içine
script gömülebilir.

## Davet akışı

Sunucu adının yanındaki kişi-ekle simgesi davet üretip linki panoya kopyalar
(`/davet/<kod>`, 7 gün geçerli). Link giriş yapmamış kullanıcıya da sunucu
önizlemesi gösterir; katılma giriş ister.

Katılan kişiye `GUILD_CREATE` **doğrudan kullanıcı kanalından** gönderilir.
Sunucu kanalına yayınlamak yetmez: yeni üyenin bağlantısı o kanala henüz
abone değildir ve o an kimse bağlı değilse olay hiç işlenmez.

## Mobil ve PWA

Dar ekranda sunucu şeridi ve kanal listesi kayar panel olur (başlıktaki
menü düğmesi açar, kanal seçince kapanır). Masaüstünde düzen değişmez.

Mobilde sık yapılan üç hata baştan kapatıldı:
`100dvh` (adres çubuğu kayarken yazma kutusu ekran dışında kalmaz),
girişlerde `16px` yazı tipi (iOS odaklanınca sayfayı yakınlaştırmaz),
`env(safe-area-inset-*)` (çentik ve alt çubuk altında içerik kalmaz).

Service worker yalnızca üretimde kayıtlı — geliştirmede sıcak yenilemeyi bozar.
Kabuk ve statik varlıklar önbelleğe alınır; **`/api` ve `/gateway` asla**.
Bayat mesaj veya bayat izin göstermek, çevrimdışı çalışmamaktan kötüdür.

> İkonlar SVG. iOS ana ekran simgesi PNG bekler, SVG'yi yok sayıp ekran
> görüntüsü kullanır — gerçek PNG çıktısı üretilene kadar bilinçli bir eksik.

## Yapılmayanlar (bilinçli)

Thread, forum kanalı, özel emoji/sticker, bot API'si, webhook, sunucu keşfi,
etkinlik, sahne kanalı, webcam video. Ses tarafında **cihaz seçimi
(mikrofon/hoparlör), bas-konuş (PTT) ve giriş hassasiyeti** henüz yok — mesh
gerçek ağlarda doğrulandıktan sonra eklenecek cilalar.

**E-posta** (`services/mail.ts`) — Amazon SES SMTP nodemailer ile bağlı
(Brevo'dan taşındı). `.env`'e `SMTP_HOST=email-smtp.<bölge>.amazonaws.com` +
SES SMTP kimlik bilgileri girilince doğrulama ve parola sıfırlama gerçekten
gönderilir; boş bırakılırsa geliştirmede konsola yazılır. Açılışta bağlantı
doğrulanıp loglanır. Gönderen alan adı SES'te doğrulanmış olmalı ve
SPF/DKIM/DMARC kaydı tamamlanmalı, yoksa spam'e düşer ya da reddedilir.
Hesap SES "sandbox" modundaysa yalnızca önceden doğrulanmış alıcılara
gönderim yapılır — üretime çıkmadan AWS konsolundan "production access"
istenmeli. İki e-posta da kısa, logolu bir HTML şablonuyla gönderiliyor
(`emailShell()`), düz metin sürümü de her zaman eşlik ediyor.

**Görsel / CSAM taraması** (`services/imageScanner.ts` + `contentScan.ts`) —
tarayıcı takılıp çıkarılabilir. Karar mantığı `imageScanner`'a devredilmiş,
sonucu veritabanına yazma ve moderatör kuyruğuna düşürme ayrı. İki yol:

- **`webhook`** — `IMAGE_SCAN_PROVIDER=webhook` + `IMAGE_SCAN_WEBHOOK_URL`
  girince yüklenen her görsel o uca POST edilir, `{"verdict":"flagged"}`
  dönerse ek engellenir ve kuyruğa düşer. PhotoDNA / Thorn Safer / Hive gibi
  bir servisin önüne konur. Tarama çökerse `IMAGE_SCAN_FAIL_MODE` belirler
  (open = geçir+incele, closed = engelle).
- **Cloudflare CSAM Scanning Tool** — domain Cloudflare'deyse zone panelinden
  ayrıca açılır (pasif, kod gerektirmez). İkisi birlikte kullanılabilir.

> **Yayına çıkmadan:** `IMAGE_SCAN_PROVIDER=none` iken hiçbir tarama yapılmaz
> ve üretimde açılışta yüksek sesle uyarılır. İnternete açık, kayıt alan bir
> platformda görsel taraması **hukuki zorunluluk** — bir sağlayıcı bağlanmadan
> canlıya çıkılmaz. Karar mantığı testli (`contentScan.test.ts`).
