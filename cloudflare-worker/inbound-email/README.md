# Tuscord — gelen destek maili Worker'ı

`info@tuscord.com` ve `destek@tuscord.com` adreslerine gelen mailleri Tuscord'un
destek talebi (ticket) sistemine aktarır. Bkz. `packages/server/src/routes/tickets.ts`
`POST /webhooks/inbound-email`.

## Kurulum (bir kere)

```bash
cd cloudflare-worker/inbound-email
npm install
npx wrangler login          # ya da CLOUDFLARE_API_TOKEN ortam değişkeni
npx wrangler secret put INBOUND_EMAIL_SECRET
npx wrangler secret put TICKET_WEBHOOK_URL   # https://tuscord.com/api/v1/webhooks/inbound-email
npm run deploy
```

`INBOUND_EMAIL_SECRET`, sunucudaki `/opt/tuscord/.env`'deki `INBOUND_EMAIL_SECRET`
ile AYNI değer olmalı — sunucu bu header'ı kontrol ediyor.

## Cloudflare Email Routing kuralı

Dashboard → tuscord.com → **Email** → **Email Routing**:
1. "Enable Email Routing" (henüz açık değilse) — gerekli MX/TXT kayıtlarını otomatik ekler.
2. **Routing rules** → **Create address**:
   - `info@tuscord.com` → **Send to a Worker** → `tuscord-inbound-email`
   - `destek@tuscord.com` → **Send to a Worker** → `tuscord-inbound-email`
