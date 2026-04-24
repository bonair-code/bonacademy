// i18n yapılandırması — locale listesi, varsayılan, cookie adı.
// URL prefix yok: dil seçimi NEXT_LOCALE cookie'sinde saklanır, 1 yıl TTL.

export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 yıl

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}
