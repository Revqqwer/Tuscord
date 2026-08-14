-- Sunucu oluşturulurken otomatik açılan "metin kanalları" KATEGORİSİNİ kaldırır.
--
-- Arka plan: eski `POST /guilds` kodu her sunucuda bir kategori (type=4) açıp
-- `genel` kanalını onun içine koyuyordu. Kanal listesi artık kanalları
-- tipine göre kendisi gruplayıp "Metin Kanalları" / "Ses Kanalları"
-- başlıklarını çizdiği için, bu kategori ekranda İKİNCİ ve birebir aynı
-- görünen bir başlık üretiyordu: kullanıcı aynı isimde iki ayrı grup
-- görüyor, `genel` bir tarafta, sonradan açılan metin kanalları diğer
-- tarafta kalıyordu.
--
-- Sıra önemli: önce çocukları köke taşı, sonra kategoriyi sil. Ters sırada
-- kanallar var olmayan bir kategoriye işaret eden `parent_id` ile kalırdı
-- (parent_id'de foreign key yok, veritabanı bunu kendisi temizlemez).
--
-- Yalnızca `type = 4` satırları etkilenir; metin/ses kanallarına ve
-- mesajlara dokunulmaz. Kategoriler yalnızca bu otomatik kodla oluştuğu
-- için (arayüzde kategori açma yok) elde kullanıcı yapımı kategori yok.

UPDATE "channels"
SET "parent_id" = NULL
WHERE "parent_id" IN (SELECT "id" FROM "channels" WHERE "type" = 4);
--> statement-breakpoint
DELETE FROM "channels" WHERE "type" = 4;
