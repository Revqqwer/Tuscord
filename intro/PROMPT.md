# Tuscord intro — uyarlanmış yönerge

**Konsept (tek satır):** *Bir yazma noktası; mesaja, sese, odaya, ağa ve sonunda Tuscord'a dönüşür.*
("…" yazıyor göstergesi → mesaj balonu → kinetik kelimeler → ses dalgası → konuşan avatar halkası →
P2P mesh ağı → Tuscord arayüzü → kanal verisi → TUSCORD harfleri → tekrar tek nokta.)

<direction>
Tuscord için 15 saniyelik, dünya standardında bir motion design intro. Konsept: "bir yazma noktası
topluluğa dönüşür". Her plan bir öncekinden yapılır: şekil, yazı ve renk bir sonraki sahneye dönüşür;
kesme ya da fade yoktur. Tek yazı tipi: Plus Jakarta Sans (Tuscord'un arayüz fontu). Palet: Tuscord
turkuazı #14b8a6, amber #faa81a, mercan #f0616d + siyah ve beyaz (üçü de Tuscord arayüzünden). Tek kamera
dili: şeklin içinden geçerek ilerleme (push-through) ve sağa doğru yatay itiş.
Gösterilecekler, eşit sürelerle: kinetik tipografi, şekil dönüşümü, 2D'den 3D'ye geçiş, Tuscord arayüzü
ve veri anı, kapanış başlığı.
Yasak: parçacık patlaması, parlama (glow), lens flare, kamera sarsıntısı, RGB ayrışması, crossfade,
jenerik gradyan, zıplayan (bouncy) easing, yarım saniyeden uzun bekleme, şablon görünümü.
</direction>

<structure>
120 BPM (vuruş = 0,5 sn), her vuruşta bir şey olur. 7,5 ölçü = 15 sn.
1. ölçü: kanca. Sonra her ölçüde bir teknik, her biri bir öncekinden doğar. Son tam ölçü: en güçlü an.
Son yarım ölçü: kapanış başlığı; son kare ilk kareyle aynıdır, video döngü yapar.
</structure>

<build>
1. 1920x1080 tek HTML. Her şey window.seek(t) içinde zamandan hesaplanır: CSS animasyonu, zamanlayıcı,
   kareler arası durum yok.
2. Zamanın fonksiyonu olarak yazılmış kritik sönümlü yay ve üstel easing. Hızlı hareketlerde bulanıklık
   hız ve yönü izler.
3. Web Audio API (OfflineAudioContext) ile kodda müzik: her vuruşta kick, son tam ölçüye giden riser,
   her sahne değişiminde vuruş (hit). WAV'a render.
4. Playwright ile 60 fps, kare başına 3 alt kare, ffmpeg tmix ile hareket bulanıklığı, ardından ses mux.
5. Tam render'dan önce her vuruştan bir kare render edilip incelenir; kalabalık, vuruş dışı, çakışan
   ya da okunaksız ne varsa düzeltilir.
</build>

## Vuruş vuruş storyboard (vuruş = 0,5 sn)

| Ölçü | Vuruş | Ne olur |
|---|---|---|
| 1 · Kanca | 0 | Siyahta tek turkuaz nokta → üç "yazıyor" noktasına ayrılır |
| | 1 | Üç nokta dalga gibi sırayla yükselir |
| | 2 | Noktalar uzayıp birleşir, turkuaz mesaj balonu olur |
| | 3 | Balona "selam" yazılır; kamera balonun içinden geçer, ekran turkuaz olur |
| 2 · Kinetik yazı | 4 | **YAZ.** harfleri yukarıdan düşer |
| | 5 | **KONUŞ.** sağdan kayarak girer, YAZ. aşağı çıkar |
| | 6 | **PAYLAŞ.** harfleri yatayda açılır |
| | 7 | **BULUŞ.** alttan girer, tek bir siyah çizgiye ezilir |
| 3 · Şekil dönüşümü | 8 | Çizgi siyah bandı açar; içindeki beyaz çizgi ses dalgasına bölünür |
| | 9 | Dalga çubukları kıvrılıp konuşma halkası olur |
| | 10 | Halka dolu bir avatara kapanır, avatar üçe ayrılır (turkuaz/amber/mercan) |
| | 11 | Avatarlara baş harfler gelir, aralarına bağlantı çizgileri çizilir |
| 4 · 2D → 3D | 12 | Üçgen geriye yatar, düzlem 3D olur |
| | 13 | Düzlemden üç yeni düğüm yükselir; tam P2P mesh ağı |
| | 14 | Ağ kendi ekseninde döner |
| | 15 | Ağ düzleşir, düğümler sol kenarda sunucu çubuğuna dizilir |
| 5 · Arayüz | 16 | Kanal paneli açılır: # genel, # borsa, # duyurular, sesli oda |
| | 17 | Mesajlar alttan kayarak gelir |
| | 18 | Tepki rozeti çıkar; yazma kutusunda "yazıyor" noktaları (kancaya selam) |
| | 19 | Sesli odaya üç avatar düşer, konuşan halka atar |
| 6 · Veri | 20 | Mesaj satırları çubuklara dönüşür: kanal aktivitesi grafiği |
| | 21 | Çubuklar büyür, sayaç artar |
| | 22 | Sıralama değişir, çubuklar yer değiştirir |
| | 23 | Çubuklar dikilip yedi dikey levhaya dönüşür (riser zirvede) |
| 7 · En güçlü an | 24 | Levhalar, yandan görünen harflerdir: T-U açılır |
| | 25 | S-C açılır; kamera kelimenin etrafında döner, 3D derinlik görünür |
| | 26 | O-R-D açılır |
| | 27 | Kelime kameraya oturur, yüzü beyazlaşır (en sert vuruş) |
| ½ · Kapanış | 28 | **TUSCORD** + altına turkuaz noktalı **tuscord.com** |
| | 29 | Her şey "." noktasına çekilir; tek turkuaz nokta = ilk kare |
