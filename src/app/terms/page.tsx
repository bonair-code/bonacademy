import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/i18n/config";

export const runtime = "nodejs";

export async function generateMetadata() {
  const t = await getTranslations("misc");
  return { title: t("terms.metaTitle") };
}

const SECTION_KEYS = [
  "scope",
  "account",
  "use",
  "records",
  "ip",
  "termination",
  "law",
] as const;

export default async function TermsPage() {
  const t = await getTranslations("misc");
  const store = await cookies();
  const rawLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  const lastUpdatedDate = new Date().toLocaleDateString(dateLocale);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto card p-8 space-y-4 text-sm text-slate-700 leading-relaxed">
        <div className="h-1 w-10 bg-brand-600 rounded-full" />
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("terms.title")}
        </h1>
        <p className="text-xs text-slate-500">
          {t("terms.lastUpdated", { date: lastUpdatedDate })}
        </p>

        <p>{t("terms.intro")}</p>

        {SECTION_KEYS.map((key) => (
          <section key={key}>
            <h2 className="font-semibold text-slate-900 mt-2">
              {t(`terms.sections.${key}.heading`)}
            </h2>
            <p>{t(`terms.sections.${key}.body`)}</p>
          </section>
        ))}

        <div className="pt-4 text-xs">
          <a href="/login" className="underline hover:text-slate-900">
            {t("terms.backToLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
