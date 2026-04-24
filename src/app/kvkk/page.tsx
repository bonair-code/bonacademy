import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/i18n/config";

export const runtime = "nodejs";

export async function generateMetadata() {
  const t = await getTranslations("misc");
  return { title: t("kvkk.metaTitle") };
}

// KVKK 6698 sayılı kanun kapsamında aydınlatma metni. Login sayfasından
// link verilir. Hukuk ekibinin gözden geçirmesi gerekir — bu bir şablondur,
// son metin Bon Air hukuk/İK tarafından onaylanmadan kullanıcılara duyurulmamalıdır.

export default async function KvkkPage() {
  const t = await getTranslations("misc");
  const store = await cookies();
  const rawLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dateLocale = locale === "tr" ? "tr-TR" : "en-GB";
  const lastUpdatedDate = new Date().toLocaleDateString(dateLocale);

  const items = t.raw("kvkk.sections.dataCollected.items") as string[];
  const intro = t("kvkk.intro");

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto card p-8 space-y-4 text-sm text-slate-700 leading-relaxed">
        <div className="h-1 w-10 bg-brand-600 rounded-full" />
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("kvkk.title")}
        </h1>
        <p className="text-xs text-slate-500">
          {t("kvkk.lastUpdated", { date: lastUpdatedDate })}
        </p>

        {intro && <p>{intro}</p>}

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.controller.heading")}
          </h2>
          <p>
            {t("kvkk.sections.controller.body")}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">kvkk@bonair.com.tr</a>.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.dataCollected.heading")}
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.purpose.heading")}
          </h2>
          <p>{t("kvkk.sections.purpose.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.transfer.heading")}
          </h2>
          <p>{t("kvkk.sections.transfer.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.retention.heading")}
          </h2>
          <p>{t("kvkk.sections.retention.body")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.rights.heading")}
          </h2>
          <p>
            {t("kvkk.sections.rights.body")}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">kvkk@bonair.com.tr</a>.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("kvkk.sections.cookies.heading")}
          </h2>
          <p>{t("kvkk.sections.cookies.body")}</p>
        </section>

        <div className="pt-4 text-xs">
          <a href="/login" className="underline hover:text-slate-900">
            {t("kvkk.backToLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
