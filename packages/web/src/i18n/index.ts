/**
 * Türkçe/İngilizce, gün 1'den (spec Bölüm 3).
 * Metinleri sonradan çıkarmak, arayüz büyüdükçe katlanarak pahalılaşır.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { tr } from './tr';
import { en } from './en';

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: localStorage.getItem('tuscord.locale') ?? 'tr',
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
});

export function setLocale(locale: 'tr' | 'en'): void {
  localStorage.setItem('tuscord.locale', locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
