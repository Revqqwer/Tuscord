-- Sesli kanallar için elle seçilebilir "sticker" (emoji rozet).
-- null = kanal id'sinden türetilen sabit varsayılan kullanılır (bkz.
-- shared/limits.ts defaultStickerForChannel). Metin kanallarında kullanılmaz.
ALTER TABLE "channels" ADD COLUMN "sticker" varchar(16);
