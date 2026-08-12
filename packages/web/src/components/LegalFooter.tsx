/**
 * Hukuki iletişim bağlantıları.
 *
 * 5651 ve KVKK, erişilebilir bir başvuru kanalı zorunlu kılıyor — giriş
 * ekranından, yani giriş yapmamış bir kullanıcının da ulaşabileceği yerden
 * görünür olmalı.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LegalContact {
  abuseEmail: string;
  hostingCountry: string;
  trafficLogRetentionDays: number;
}

export function LegalFooter() {
  const { t } = useTranslation();
  const [contact, setContact] = useState<LegalContact | null>(null);

  useEffect(() => {
    // Bu uç bilerek /api/v1 dışında: hukuki iletişim bilgisi sürümlenmiş
    // API'nin değil, sitenin kendisinin bir parçası.
    void fetch('/legal/contact')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: LegalContact | null) => setContact(data))
      .catch(() => undefined);
  }, []);

  return (
    <footer className="mt-6 text-center text-xs text-[var(--color-ink-faint)]">
      <a href="/gizlilik" className="hover:text-[var(--color-ink-muted)]">
        {t('legal.privacy')}
      </a>
      <span className="mx-2">·</span>
      <a href="/kosullar" className="hover:text-[var(--color-ink-muted)]">
        {t('legal.terms')}
      </a>
      {contact && (
        <>
          <span className="mx-2">·</span>
          <a href={`mailto:${contact.abuseEmail}`} className="hover:text-[var(--color-ink-muted)]">
            {t('legal.abuse')}
          </a>
        </>
      )}
    </footer>
  );
}
