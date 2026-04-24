import { getTranslations } from "next-intl/server";

export default async function Forbidden() {
  const t = await getTranslations("misc");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold mb-2">{t("forbidden.title")}</h1>
        <p className="text-slate-500">{t("forbidden.body")}</p>
      </div>
    </div>
  );
}
