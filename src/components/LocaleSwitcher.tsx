import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from "@/i18n/config";

// Dil seçici — Server Action ile NEXT_LOCALE cookie yazar, kullanıcıyı
// geldiği sayfaya geri yönlendirir. URL'de locale prefix yok; cookie 1 yıl
// kalıcı, oturumdan bağımsız.

async function setLocaleAction(formData: FormData) {
  "use server";
  const { auth } = await import("@/lib/auth");
  const { prisma } = await import("@/lib/db");
  const raw = String(formData.get("locale") || "");
  const nextRaw = String(formData.get("next") || "/");
  const locale: Locale = isLocale(raw) ? raw : "en";
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  // Oturum açıksa kullanıcının tercihini DB'ye de yaz — mail'ler bu dile gidecek.
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (userId) {
      await prisma.user.update({ where: { id: userId }, data: { locale } });
    }
  } catch {
    // Cookie zaten yazıldı, DB başarısız olsa bile UI çalışsın.
  }
  // Açık yönlendirme koruması: yalnızca aynı site içi path.
  const safe = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  redirect(safe);
}

export async function LocaleSwitcher({
  nextPath,
  className = "",
}: {
  nextPath?: string;
  className?: string;
}) {
  const current = await getLocale();
  const t = await getTranslations("locale");
  let next = nextPath;
  if (!next) {
    // nextPath verilmediyse Referer'dan path çıkar.
    const h = await headers();
    const ref = h.get("referer");
    if (ref) {
      try {
        next = new URL(ref).pathname;
      } catch {
        next = "/";
      }
    } else {
      next = "/";
    }
  }

  return (
    <form action={setLocaleAction} className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <input type="hidden" name="next" value={next} />
      {LOCALES.map((l) => {
        const active = l === current;
        return (
          <button
            key={l}
            type="submit"
            name="locale"
            value={l}
            aria-label={t("switchTo")}
            aria-pressed={active}
            className={
              active
                ? "px-2 py-1 rounded-md bg-slate-900 text-white font-medium"
                : "px-2 py-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            }
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </form>
  );
}
