import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

// EN namespaces
import enBase from "./messages/en.json";
import enAdmin from "./messages/en/admin.json";
import enAdminCourses from "./messages/en/adminCourses.json";
import enAdminPlans from "./messages/en/adminPlans.json";
import enCoursePlayer from "./messages/en/coursePlayer.json";
import enExam from "./messages/en/exam.json";
import enMisc from "./messages/en/misc.json";
import enUi from "./messages/en/ui.json";
import enUser from "./messages/en/user.json";

// TR namespaces
import trBase from "./messages/tr.json";
import trAdmin from "./messages/tr/admin.json";
import trAdminCourses from "./messages/tr/adminCourses.json";
import trAdminPlans from "./messages/tr/adminPlans.json";
import trCoursePlayer from "./messages/tr/coursePlayer.json";
import trExam from "./messages/tr/exam.json";
import trMisc from "./messages/tr/misc.json";
import trUi from "./messages/tr/ui.json";
import trUser from "./messages/tr/user.json";

// Static imports — Next.js build bunları trace eder ve bundle'a ekler.
// fs.readdirSync yaklaşımı yerel dev'de çalışır ama Vercel serverless çıktısına
// dahil edilmez; bu yüzden tüm namespace dosyalarını burada elle birleştiriyoruz.
const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: {
    ...enBase,
    ...enAdmin,
    ...enAdminCourses,
    ...enAdminPlans,
    ...enCoursePlayer,
    ...enExam,
    ...enMisc,
    ...enUi,
    ...enUser,
  },
  tr: {
    ...trBase,
    ...trAdmin,
    ...trAdminCourses,
    ...trAdminPlans,
    ...trCoursePlayer,
    ...trExam,
    ...trMisc,
    ...trUi,
    ...trUser,
  },
};

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return { locale, messages: MESSAGES[locale] };
});
