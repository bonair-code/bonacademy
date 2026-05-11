import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/i18n/config";

export const runtime = "nodejs";

export async function generateMetadata() {
  const t = await getTranslations("misc");
  return { title: t("privacy.metaTitle") };
}

export default async function PrivacyPage() {
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
          {t("privacy.title")}
        </h1>
        <p className="text-xs text-slate-500">
          {t("privacy.lastUpdated", { date: lastUpdatedDate })}
        </p>

        <p>
          {t("privacy.intro")}
          <a className="underline" href="/kvkk">
            {t("privacy.kvkkLink")}
          </a>
          {t("privacy.introCont")}
        </p>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.collection.heading")}
          </h2>
          <p>{t("privacy.sections.collection.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.use.heading")}
          </h2>
          <p>{t("privacy.sections.use.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.sharing.heading")}
          </h2>
          <p>{t("privacy.sections.sharing.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.retention.heading")}
          </h2>
          <p>{t("privacy.sections.retention.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.security.heading")}
          </h2>
          <p>{t("privacy.sections.security.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.rights.heading")}
          </h2>
          <p>
            {t("privacy.sections.rights.body")}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">
              kvkk@bonair.com.tr
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("privacy.sections.contact.heading")}
          </h2>
          <p>
            {t("privacy.sections.contact.body")}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">
              kvkk@bonair.com.tr
            </a>
            .
          </p>
        </section>

        <div className="pt-4 text-xs">
          <a href="/login" className="underline hover:text-slate-900">
            {t("privacy.backToLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
