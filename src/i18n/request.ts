import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

// next-intl entry point. Cookie'deki dili okur, yoksa DEFAULT_LOCALE
// (İngilizce). Tarayıcı Accept-Language'a bakılmıyor — kasıtlı: tek, net
// varsayılan + kullanıcı seçimi. Seçim cookie'de kalıcı.
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const messages = (await import(`./messages/${locale}.json`)).default;
  return { locale, messages };
});
