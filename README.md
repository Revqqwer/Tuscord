# Tuscord

Discord yapısında topluluk sohbet platformu. Türkiye'den VPN'siz erişilebilir,
kendi markası olan, sıfırdan yazılmış.

Kapsam ve kararlar: [PROJE-SPEC.md](../PROJE-SPEC.md)

**Durum:** Faz 1 (metin) — çekirdek tamamlandı, gerçek kullanıcı testi bekliyor.

## Alınan kararlar (bu oturumda)

| Karar | Değer |
|---|---|
| İsim | **Tuscord** (domain sonra) |
| Barındırma | **Türkiye** — 5651 yer sağlayıcı yükümlülüğü doğrudan bizde, KVKK yurt dışı aktarım evrakı gerekmiyor |
| Trafik kaydı saklama | 365 gün, otomatik silme (`TRAFFIC_LOG_RETENTION_DAYS`) |
| Ana renk | `#14b8a6` turkuaz — Discord'un `#5865F2`'sinden belirgin farklı |

> **Marka uyarısı:** Domain almadan önce TÜRKPATENT ve EUIPO'da "Tuscord"
> araması yap. Revolt projesi bu adımı atladığı için ihtarname aldı ve
> Ekim 2025'te Stoat olmak zorunda kaldı.

## Yapı

```
packages/
  shared/   izin motoru, snowflake, API tipleri, gateway protokolü  (istemci+sunucu ortak)
  server/   Fastify REST + ws gateway + Drizzle/Postgres
  web/      React + Vite + Tailwind
docker/     Caddyfile, üretim compose, sunucu imajı
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
birim testleri. Şu an 119 test (izin 41, markdown 33, dosya tipi 20,
hız sınırı 14, snowflake 11). **İzin motorunu değiştirirken testleri önce
yaz** — Discord klonlarının en sık patladığı yer burası.

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

## Dağıtım (Faz 1)

En ucuz kurulum: tek TR VPS + Docker Compose + Caddy + Cloudflare (ücretsiz).
R2 gerekmez — dosyalar yerel diskte kalıcı volume'de durur (~100 kullanıcı için yeter).

**Adımlar:**

```bash
# 1. Web'i derle (Caddy dist'ten statik servis eder)
npm run build --workspace=@tuscord/shared
npm run build --workspace=@tuscord/web

# 2. .env hazırla (aşağıdaki asgari alanlar)
cp .env.example .env   # düzenle

# 3. Servisleri ayağa kaldır (api imajı burada build edilir)
docker compose -f docker/compose.prod.yml up -d --build

# 4. Şemayı kur — prod imajında derlenmiş dist çalışır (src DEĞİL)
docker compose -f docker/compose.prod.yml exec api node packages/server/dist/db/migrate.js
```

**`.env`'de üretim için asgari:**
`NODE_ENV=production`, `COOKIE_SECURE=true`, `SESSION_SECRET` (32+ bayt),
`POSTGRES_PASSWORD`, `WEB_ORIGIN=https://alanadi`, `COOKIE_DOMAIN=alanadi`.
R2 alanları boş bırakılırsa yerel disk kullanılır.

**`docker/Caddyfile`** içindeki `ALAN_ADI`'nı gerçek domain ile değiştir.
Cloudflare önde: DNS + CDN + DDoS + WAF, hepsi ücretsiz katman.

> **Deploy öncesi doğrulandı** (bu makinede prod imajı build edilip çalıştırıldı):
> `@tuscord/shared` prod'da dist'ten çözülüyor, R2'siz yerel diske düşüyor,
> yükleme volume'ü kalıcı, `/health` → 200. İki tuzak baştan kapatıldı:
> shared'in giriş noktası prod'da dist'e yönlendiriliyor (Dockerfile), ve
> `uploads` named volume olmadan konteyner restart'ında dosyalar uçardı.

Faz 2'ye geçmeden önce: LiveKit için **UDP 50000–50100 ve TCP 7881**
hem sunucu iptables'ında hem sağlayıcı panelinde açık olmalı.

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
etkinlik, sahne kanalı. Sesli sohbet Faz 2, ekran paylaşımı Faz 3.

**E-posta** (`services/mail.ts`) — Brevo SMTP nodemailer ile bağlı. `.env`'e
`SMTP_HOST=smtp-relay.brevo.com` + SMTP anahtarları girilince doğrulama ve
parola sıfırlama gerçekten gönderilir; boş bırakılırsa geliştirmede konsola
yazılır. Açılışta bağlantı doğrulanıp loglanır. Gönderen alan adı Brevo'da
doğrulanmış olmalı ve SPF/DKIM/DMARC kaydı tamamlanmalı, yoksa spam'e düşer.

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
