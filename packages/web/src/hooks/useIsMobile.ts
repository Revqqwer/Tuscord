import { useEffect, useState } from 'react';

/** Tailwind'in `md` kırılma noktası. Tek yerde tanımlı olsun. */
const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Ekran dar mı?
 *
 * Kayar panelin konumu React tarafında hesaplanıyor; salt CSS ile
 * yapılan denemede Tailwind v4 kuralları derlenen çıktıya taşımadı ve
 * panel açık durumdayken bile kapalı konumda kaldı. Açık bir stil,
 * sessizce kaybolan bir utility'den iyidir.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}
