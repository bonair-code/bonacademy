import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

// next-intl entry point. Cookie'deki dili okur, yoksa DEFAULT_LOCALE.
// Mesajlar iki kaynaktan okunur ve merge edilir:
//   1. src/i18n/messages/{locale}.json (ana/merkez dosya)
//   2. src/i18n/messages/{locale}/*.json (namespace dosyaları — sayfa/modül başına)
// Namespace dosyaları kök seviyesinde deep-merge edilir; çakışan anahtarda
// namespace dosyası öncelikli (modül başına çeviri düzenlemesi kolay).
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const base = (await import(`./messages/${locale}.json`)).default as Record<string, unknown>;
  const dir = path.join(process.cwd(), "src", "i18n", "messages", locale);
  let merged: Record<string, unknown> = { ...base };
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      merged = { ...merged, ...content };
    }
  } catch {
    // Dizin yoksa sadece base kullan.
  }
  return { locale, messages: merged };
});
