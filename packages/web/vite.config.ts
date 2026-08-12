import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Yerel ağdaki cihazlardan (telefon) erişim için tüm arayüzlere bağlan.
    // Güvenli değil, yalnızca geliştirme; üretimde Caddy önde durur.
    host: true,
    proxy: {
      // Geliştirmede API ve gateway aynı origin'den gelsin: cookie'ler
      // (SameSite=lax, HttpOnly) çapraz origin'de sorun çıkarır.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/legal': { target: 'http://localhost:3001', changeOrigin: true },
      '/gateway': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
