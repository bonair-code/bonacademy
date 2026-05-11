import { getTranslations } from "next-intl/server";

export const runtime = "nodejs";

export async function generateMetadata() {
  const t = await getTranslations("misc");
  return { title: t("contact.metaTitle") };
}

export default async function ContactPage() {
  const t = await getTranslations("misc");

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto card p-8 space-y-4 text-sm text-slate-700 leading-relaxed">
        <div className="h-1 w-10 bg-brand-600 rounded-full" />
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("contact.title")}
        </h1>
        <p>{t("contact.intro")}</p>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("contact.sections.company.heading")}
          </h2>
          <p>{t("contact.sections.company.name")}</p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("contact.sections.support.heading")}
          </h2>
          <p>
            {t("contact.sections.support.body")}
            <a className="underline" href="mailto:destek@bonair.com.tr">
              destek@bonair.com.tr
            </a>
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("contact.sections.kvkk.heading")}
          </h2>
          <p>
            {t("contact.sections.kvkk.body")}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">
              kvkk@bonair.com.tr
            </a>
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">
            {t("contact.sections.training.heading")}
          </h2>
          <p>{t("contact.sections.training.body")}</p>
        </section>

        <div className="pt-4 text-xs">
          <a href="/login" className="underline hover:text-slate-900">
            {t("contact.backToLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
