import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Inter değişken fontu — kendi kendine barındırılır (CDN yok), build'e gömülür.
// Discord'un telifli ggsans'ının açık lisanslı, ruhen yakın karşılığı.
import '@fontsource-variable/inter';
import './i18n';
import './index.css';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Canlı veri gateway'den geliyor; pencereye dönünce yeniden çekmek
      // gereksiz istek üretir.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root bulunamadı');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

/**
 * Service worker yalnızca üretimde kaydedilir.
 *
 * Geliştirmede kayıtlı bir worker, Vite'ın sıcak yenilemesini bozar ve
 * "neden değişikliğim görünmüyor" saatlerine yol açar.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker kaydedilemedi', error);
    });
  });
}
