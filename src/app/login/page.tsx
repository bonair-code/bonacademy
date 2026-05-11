import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyRecaptchaToken } from "@/lib/captcha";
import { RecaptchaV3 } from "@/components/RecaptchaV3";
import { PasswordField } from "@/components/PasswordField";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

const MAX_ATTEMPTS = 3;

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const captchaToken = String(formData.get("captchaToken") || "");

  const cap = await verifyRecaptchaToken(captchaToken, "login");
  if (!cap.ok) return redirect("/login?error=captcha");
  if (!email || !password) return redirect("/login?error=empty");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return redirect("/login?error=bad");
  }
  if (user.lockedAt) {
    return redirect("/login?error=locked");
  }

  const after = await prisma.user.findUnique({
    where: { email },
    select: { failedLoginAttempts: true, lockedAt: true },
  });
  if (after?.lockedAt) return redirect("/login?error=locked");

  try {
    await signIn("password", { email, password, redirectTo: "/dashboard" });
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    const fresh = await prisma.user.findUnique({
      where: { email },
      select: { failedLoginAttempts: true, lockedAt: true },
    });
    if (fresh?.lockedAt) return redirect("/login?error=locked");
    const left = Math.max(0, MAX_ATTEMPTS - (fresh?.failedLoginAttempts ?? 0));
    return redirect(`/login?error=bad&left=${left}`);
  }

  redirect("/dashboard");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    left?: string;
    invited?: string;
    reset?: string;
    setup?: string;
  }>;
}) {
  const { error, left, invited, reset, setup } = await searchParams;
  const t = await getTranslations("login");
  const tc = await getTranslations("common");

  let errorMsg: string | null = null;
  if (error === "captcha") errorMsg = t("error.captcha");
  else if (error === "empty") errorMsg = t("error.empty");
  else if (error === "bad")
    errorMsg = left ? t("error.badWithLeft", { left }) : t("error.bad");
  else if (error === "locked") errorMsg = t("error.locked");

  let okMsg: string | null = null;
  if (invited === "1") okMsg = t("success.invited");
  else if (reset === "1") okMsg = t("success.reset");
  else if (setup === "ok") okMsg = t("success.setup");

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Background image — supplied at public/login-bg.jpg */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
        aria-hidden
      />
      {/* Dark overlay for legibility */}
      <div className="absolute inset-0 bg-slate-900/55" aria-hidden />

      {/* Locale switcher — top right */}
      <div className="absolute top-4 right-4 z-20">
        <LocaleSwitcher nextPath="/login" />
      </div>

      {/* Foreground grid */}
      <div className="relative z-10 min-h-screen grid lg:grid-cols-2 items-center px-6 py-10 lg:px-16 gap-8">
        {/* Left — marketing overlay (hidden on small screens) */}
        <div className="hidden lg:flex flex-col text-white max-w-xl">
          <div className="text-xs tracking-[0.25em] uppercase text-slate-300 mb-3">
            {t("subheading")}
          </div>
          <div className="h-1 w-14 bg-brand-600 rounded-full mb-5" />
          <h2 className="text-3xl xl:text-4xl font-semibold leading-tight mb-4">
            {t("tagline")}
          </h2>
          <p className="text-sm text-slate-200/90 leading-relaxed mb-6 max-w-md">
            {t("blurb")}
          </p>
          <div className="flex flex-wrap gap-2">
            {[t("card.scorm"), t("card.auto"), t("card.cert"), t("card.qr")].map(
              (label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded-full bg-white/10 backdrop-blur border border-white/15 px-3 py-1.5 text-xs text-white"
                >
                  {label}
                </span>
              ),
            )}
          </div>
          <div className="mt-8 text-[11px] text-slate-300/80 tracking-wide">
            © {new Date().getFullYear()} {tc("copyright")}
          </div>
        </div>

        {/* Right — floating white card */}
        <div className="flex justify-center lg:justify-end">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl px-8 py-8">
            <div className="flex justify-center mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/Logo.png" alt="Bon Air" className="h-12 w-auto" />
            </div>

            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {t("heading")}
              </h1>
              <p className="text-sm text-slate-500 mt-1">{t("subheading")}</p>
            </div>

            <form action={loginAction} className="space-y-4">
              <div>
                <label className="label">{t("email")}</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  className="input mt-1"
                  placeholder={t("emailPlaceholder")}
                />
              </div>
              <div>
                <label className="label">{t("password")}</label>
                <PasswordField name="password" required autoComplete="current-password" />
              </div>

              <RecaptchaV3 action="login" />

              <div className="flex items-center">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    name="remember"
                    type="checkbox"
                    defaultChecked
                    className="accent-brand-600"
                  />
                  {t("remember")}
                </label>
              </div>

              {okMsg && (
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {okMsg}
                </p>
              )}

              {errorMsg && (
                <p className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}

              <button className="btn-dark w-full py-2.5">{t("submit")}</button>
            </form>

            <p className="text-center mt-5">
              <a
                href="/forgot"
                className="text-xs font-medium text-brand-700 hover:text-brand-800 underline"
              >
                {t("forgot")}
              </a>
            </p>

            <p className="text-[11px] text-slate-400 text-center mt-6">{tc("support")}</p>
            <p className="text-[11px] text-center mt-2">
              <a href="/kvkk" className="text-slate-500 hover:text-brand-700 underline">
                {t("privacy")}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
