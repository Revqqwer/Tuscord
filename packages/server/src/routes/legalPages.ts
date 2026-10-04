/**
 * Gizlilik Politikası ve Kullanım Koşulları — statik HTML sayfalar.
 *
 * BİLEREK API'nin (/api/v1) DIŞINDA ve React SPA'nın DIŞINDA: App Store
 * Connect + KVKK/GDPR başvuruları için JS çalışmadan, giriş yapmadan
 * erişilebilir gerçek bir URL şart (bkz. LegalFooter.tsx — daha önce bu
 * linkler hiçbir yere gitmiyordu, SPA fallback'e düşüyordu).
 */
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

const STYLE = `
  body{background:#0f1115;color:#e6e8ec;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;
    max-width:720px;margin:0 auto;padding:32px 20px 80px;line-height:1.65}
  h1{font-size:1.6rem;margin-bottom:.25rem}
  h2{font-size:1.15rem;margin-top:2rem;color:#e6e8ec;border-bottom:1px solid #262b34;padding-bottom:.4rem}
  p,li{color:#9aa2b1;font-size:.95rem}
  .updated{color:#6b7280;font-size:.85rem;margin-bottom:2rem}
  a{color:#14b8a6}
  ul{padding-left:1.2rem}
`;

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Tuscord</title>
<style>${STYLE}</style>
</head><body>
<h1>${title}</h1>
<p class="updated">Son güncelleme: 2026-09-27</p>
${bodyHtml}
</body></html>`;
}

export async function legalPageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gizlilik', async (_request, reply) => {
    const html = page(
      'Gizlilik Politikası',
      `
<p>Bu politika, <strong>Tuscord</strong> (tuscord.com, masaüstü ve mobil uygulamaları)
kullanırken hangi verilerinizin toplandığını ve nasıl kullanıldığını açıklar.
Veri sorumlusu: <strong>Hasan Kılıçarslan</strong> — iletişim: <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></p>

<h2>Topladığımız veriler</h2>
<ul>
  <li><strong>Hesap bilgileri:</strong> kullanıcı adı, e-posta adresi, parola (tek yönlü
    hash olarak — argon2id — biz de dahil kimse gerçek parolanızı göremez).</li>
  <li><strong>Profil bilgileri:</strong> görünen ad, avatar, biyografi (isteğe bağlı,
    kendiniz eklerseniz).</li>
  <li><strong>İçerik:</strong> gönderdiğiniz mesajlar, dosya/görsel ekleri, sunucu/kanal
    adları — hizmeti sağlamak için sunucularımızda saklanır.</li>
  <li><strong>Sesli/görüntülü iletişim:</strong> sesli kanal ve ekran paylaşımı verisi
    kendi barındırdığımız LiveKit sunucusu üzerinden anlık olarak iletilir,
    <strong>kayıt edilmez</strong>.</li>
  <li><strong>Teknik/güvenlik kayıtları:</strong> IP adresi, tarayıcı/cihaz bilgisi,
    zaman damgası — kötüye kullanımı önlemek ve 5651 sayılı kanun kapsamındaki
    yükümlülükler için ${env.TRAFFIC_LOG_RETENTION_DAYS} gün saklanır.</li>
  <li><strong>Bildirim aboneliği:</strong> tarayıcı/cihaz push bildirim jetonu — size
    bildirim gönderebilmek için, üçüncü taraflarla paylaşılmaz (Apple/Google'ın
    kendi bildirim servisleri hariç, teknik olarak zorunlu).</li>
</ul>

<h2>Verilerinizi nasıl kullanıyoruz</h2>
<ul>
  <li>Hesabınızı oluşturmak, oturumunuzu yönetmek ve size hizmeti sunmak için.</li>
  <li>Kötüye kullanımı, dolandırıcılığı ve yasa dışı içeriği tespit edip önlemek için.</li>
  <li>Yeni mesaj/bahsetme bildirimleri göndermek için (izin verirseniz).</li>
  <li>Yasal yükümlülüklerimizi (5651, KVKK) yerine getirmek için.</li>
</ul>
<p>Verileriniz <strong>reklam amacıyla satılmaz veya üçüncü taraflarla paylaşılmaz.</strong>
Sunucularımız Türkiye'de barındırılır.</p>

<h2>Haklarınız (KVKK md. 11)</h2>
<ul>
  <li>Hangi verilerinizin işlendiğini öğrenme.</li>
  <li>Yanlış/eksik verilerin düzeltilmesini isteme.</li>
  <li>Hesabınızı <strong>uygulama içinden</strong> (Ayarlar → Hesabı Sil) kapatıp
    kişisel bilgilerinizi (kullanıcı adı, e-posta, avatar, biyografi) kaldırma. Mesajlar
    yasal saklama nedeniyle anonim olarak kalır — ayrıntılar için
    <a href="/hesap-silme">Hesap ve Veri Silme</a> sayfası.</li>
  <li>Verilerinizin işlenmesine itiraz etme.</li>
</ul>
<p>Bu haklarla ilgili talepleriniz için <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a>
adresinden bize ulaşabilirsiniz; talepler en geç 30 gün içinde yanıtlanır.</p>

<h2>Çocukların gizliliği</h2>
<p>Tuscord 13 yaş ve üzeri kullanıcılar için tasarlanmıştır. 13 yaşından küçük
kullanıcılardan bilerek veri toplamıyoruz; bu yaşın altında olduğunu fark ettiğimiz
hesapları ve verilerini sileriz. 18 yaşından küçük kullanıcıların Tuscord'u yasal
temsilcilerinin (veli) bilgisi ve onayıyla kullanması gerekir.</p>

<h2>İletişim</h2>
<p>Sorularınız için: <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></p>
`,
    );
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // Google Play "hesap silme" politikası: uygulama dışından erişilebilen, silme
  // adımlarını ve silinen/saklanan veriyi anlatan herkese açık bir URL ister.
  app.get('/hesap-silme', async (_request, reply) => {
    const html = page(
      'Hesap ve Veri Silme',
      `
<p><strong>Tuscord</strong> hesabınızı ve ona bağlı verileri istediğiniz zaman kalıcı olarak silebilirsiniz.</p>

<h2>Uygulama içinden silme (önerilen)</h2>
<ol>
  <li>Tuscord'a giriş yapın (tuscord.com, masaüstü veya mobil uygulama).</li>
  <li><strong>Ayarlar → Hesabı Sil</strong> bölümüne gidin ve silmeyi onaylayın.</li>
  <li>Sahibi olduğunuz bir sunucu varsa önce onu silin veya başka birine devredin.</li>
</ol>

<h2>Giriş yapamıyorsanız</h2>
<p>Hesabınıza erişemiyorsanız, kayıtlı e-posta adresinizden
<a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a> adresine
"Hesap silme talebi" konulu bir e-posta gönderin; hesabın size ait olduğunu doğruladıktan sonra
en geç 30 gün içinde sileriz.</p>

<h2>Neler silinir?</h2>
<ul>
  <li>Hesabınız kapatılır ve <strong>anonimleştirilir</strong>: kullanıcı adı, görünen ad, e-posta adresi,
    avatar ve biyografiniz kaldırılır; bu hesapla bir daha giriş yapılamaz.</li>
  <li>Oturumlarınız sonlandırılır ve sunucu üyelikleriniz kaldırılır.</li>
</ul>

<h2>Neler bir süre saklanır?</h2>
<ul>
  <li>Gönderdiğiniz <strong>mesajlar silinmez</strong>; yasal saklama yükümlülükleri (5651 sayılı kanun) ve
    diğer kullanıcıların sohbet geçmişinin bütünlüğü nedeniyle "silinmiş kullanıcı" adıyla,
    sizinle ilişkilendirilemeyecek biçimde kalır. Belirli bir mesajın kaldırılmasını isterseniz
    yukarıdaki e-posta adresine yazın.</li>
  <li>Teknik erişim kayıtları (IP adresi, zaman damgası) ${env.TRAFFIC_LOG_RETENTION_DAYS} gün saklanır ve
    sonrasında silinir.</li>
</ul>

<h2>İletişim</h2>
<p>Sorularınız için: <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></p>
`,
    );
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // Google Play "Çocuk Güvenliği Standartları" politikası: CSAE'ye karşı herkese açık,
  // PDF olmayan bir standartlar sayfası + bildirim kanalı + iletişim kişisi ister.
  app.get('/cocuk-guvenligi', async (_request, reply) => {
    const html = page(
      'Çocuk Güvenliği Standartları',
      `
<p><strong>Tuscord</strong>'ta çocukların cinsel istismarı ve sömürüsüne (CSAE) ve çocuk cinsel
istismarı materyaline (CSAM) <strong>sıfır tolerans</strong> uygulanır. Bu sayfa, bu konudaki
standartlarımızı ve işleyişimizi açıklar.</p>

<h2>Yasak içerik ve davranışlar</h2>
<ul>
  <li>Çocukları cinselleştiren her türlü içerik (görsel, video, metin, çizim, bağlantı).</li>
  <li>Reşit olmayanlarla cinsel içerikli iletişim kurmak, onları bu amaçla ayartmak veya
    manipüle etmek (grooming).</li>
  <li>Çocuk istismarı materyalinin paylaşılması, istenmesi, ticarete konu edilmesi veya
    bunlara yönlendirme yapılması.</li>
</ul>
<p>Bu kurallar <a href="/kosullar">Kullanım Koşulları</a>'nın bir parçasıdır; ihlal eden hesaplar
uyarı yapılmadan kalıcı olarak kapatılabilir.</p>

<h2>Yaş sınırı</h2>
<p>Tuscord 13 yaş ve üzeri kullanıcılar için tasarlanmıştır; kayıt sırasında kullanıcıdan
Kullanım Koşulları'nı kabul etmesi istenir. 18 yaşından küçük kullanıcıların yasal
temsilcisinin bilgisi ve onayı gerekir.</p>

<h2>Nasıl bildirirsiniz?</h2>
<ul>
  <li><strong>Uygulama içinden:</strong> herhangi bir mesajı veya kullanıcıyı şikayet edebilirsiniz.
    Şikayetler ekibimizce incelenir.</li>
  <li><strong>E-posta ile:</strong>
    <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></li>
</ul>

<h2>Bildirimlere nasıl yanıt veririz?</h2>
<ul>
  <li>Bildirilen içerik öncelikli olarak incelenir ve CSAE/CSAM tespit edilirse hemen kaldırılır.</li>
  <li>İlgili hesap kalıcı olarak kapatılır ve kullanıcı engellenir.</li>
  <li>İlgili kayıtlar delil olarak saklanır ve yasaların gerektirdiği durumlarda yetkili
    makamlara bildirilir.</li>
  <li>Kullanıcılar, istemedikleri kişileri uygulama içinden engelleyebilir.</li>
</ul>

<h2>İletişim kişisi</h2>
<p>Çocuk güvenliği uygulamalarımız hakkında bilgi almak isteyen yetkililer ve platform
sağlayıcıları için: <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></p>
`,
    );
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/kosullar', async (_request, reply) => {
    const html = page(
      'Kullanım Koşulları',
      `
<p>Bu koşullar, <strong>Tuscord</strong>'u (tuscord.com, masaüstü ve mobil
uygulamaları) kullanırken uymanız gereken kuralları açıklar. Hizmete kaydolarak
veya kullanarak bu koşulları kabul etmiş sayılırsınız.</p>

<h2>Hesap</h2>
<ul>
  <li>Hesabınızın güvenliğinden siz sorumlusunuz; parolanızı kimseyle paylaşmayın.</li>
  <li>Hesabınızı dilediğiniz zaman Ayarlar → "Hesabı Sil" ile kalıcı olarak
    silebilirsiniz.</li>
  <li>13 yaşından küçükseniz Tuscord'u kullanmamalısınız. 18 yaşından küçükseniz
    yasal temsilcinizin (veli) bilgisi ve onayı gerekir.</li>
</ul>

<h2>Yasak davranışlar</h2>
<ul>
  <li>Yasa dışı içerik paylaşmak (nefret söylemi, taciz, çocuk istismarı materyali,
    şiddet çağrısı, dolandırıcılık vb.).</li>
  <li>Başka bir kullanıcıyı taklit etmek veya kimliğini gizlemek amacıyla yanıltmak.</li>
  <li>Hizmeti kötüye kullanmak (spam, otomatik bot trafiği, güvenlik açıklarını
    istismar etmek).</li>
  <li>Başkalarının fikri mülkiyet haklarını ihlal eden içerik paylaşmak.</li>
</ul>

<h2>Moderasyon</h2>
<p>Kullanıcılar, mesajları ve diğer kullanıcıları uygulama içinden şikayet
edebilir ve engelleyebilir. Şikayetler ekibimiz tarafından incelenir; kural
ihlali tespit edilen içerik kaldırılır, ilgili hesap uyarılır, geçici olarak
askıya alınır veya kalıcı olarak kapatılabilir. Kararlara itiraz etmek için
<a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a>
adresinden bize ulaşabilirsiniz.</p>

<h2>İçerik sahipliği</h2>
<p>Paylaştığınız içeriğin (mesaj, dosya, görsel) sahibi sizsiniz. Hizmeti
sağlayabilmemiz için (iletme, saklama, gösterme) bize gerekli asgari lisansı
verirsiniz — bu içeriği başka bir amaçla kullanmayız.</p>

<h2>Hizmetin durumu</h2>
<p>Tuscord "olduğu gibi" sunulur, kesintisiz veya hatasız çalışacağı garanti
edilmez. Hizmeti geliştirmek, değiştirmek veya (önceden makul ölçüde haber
vererek) sonlandırmak hakkımızı saklı tutarız.</p>

<h2>Sorumluluk sınırı</h2>
<p>Yasaların izin verdiği azami ölçüde, Tuscord kullanımınızdan doğabilecek
dolaylı zararlardan sorumlu tutulamayız.</p>

<h2>Değişiklikler</h2>
<p>Bu koşulları güncelleyebiliriz; önemli değişikliklerde sizi bilgilendiririz.
Güncel sürüm her zaman bu sayfada yer alır.</p>

<h2>İletişim</h2>
<p>Sorularınız için: <a href="mailto:${env.ABUSE_CONTACT_EMAIL}">${env.ABUSE_CONTACT_EMAIL}</a></p>
`,
    );
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
