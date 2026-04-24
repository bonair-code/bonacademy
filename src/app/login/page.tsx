import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyRecaptchaToken } from "@/lib/captcha";
import { RecaptchaV3 } from "@/components/RecaptchaV3";
import { PasswordField } from "@/components/PasswordField";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

const MAX_ATTEMPTS = 3;
const azureConfigured =
  !!process.env.AUTH_AZURE_AD_CLIENT_ID &&
  !!process.env.AUTH_AZURE_AD_CLIENT_SECRET &&
  !!process.env.AUTH_AZURE_AD_TENANT_ID;

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
  }>;
}) {
  const { error, left, invited, reset } = await searchParams;
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

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="hidden lg:flex relative overflow-hidden bg-slate-900 text-white px-12 pt-8 pb-6 flex-col gap-6 lg:h-screen">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #e31e24 0%, transparent 45%), radial-gradient(circle at 80% 70%, #e31e24 0%, transparent 40%)",
          }}
        />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 bg-white rounded-xl px-5 py-4 shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo.png" alt="Bon Air" className="h-16 w-auto" />
          </div>
        </div>
        <div className="relative z-10 max-w-md flex-1">
          <div className="h-1 w-14 bg-brand-600 rounded-full mb-4" />
          <h2 className="text-3xl font-semibold tracking-tight leading-tight mb-2">
            {t("tagline")}
          </h2>
          <p className="text-slate-300 text-sm leading-relaxed">{t("blurb")}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">{t("card.scorm")}</div>
              <div className="text-slate-400">{t("card.scormSub")}</div>
            </div>
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">{t("card.auto")}</div>
              <div className="text-slate-400">{t("card.autoSub")}</div>
            </div>
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">{t("card.cert")}</div>
              <div className="text-slate-400">{t("card.certSub")}</div>
            </div>
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">{t("card.qr")}</div>
              <div className="text-slate-400">{t("card.qrSub")}</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 text-[11px] text-slate-500 tracking-wide">
          © {new Date().getFullYear()} {tc("copyright")}
        </div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 bg-white relative">
        <div className="absolute top-4 right-4">
          <LocaleSwitcher nextPath="/login" />
        </div>
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo.png" alt="Bon Air" className="h-20 w-auto mb-2" />
          </div>

          <div className="mb-8">
            <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t("heading")}
            </h1>
            <p className="text-sm text-slate-500 mt-1">{t("subheading")}</p>
          </div>

          {azureConfigured && (
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
              }}
              className="mb-4"
            >
              <button className="btn-secondary w-full">{t("withMicrosoft")}</button>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400">
                  {t("or")}
                </span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            </form>
          )}

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

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  name="remember"
                  type="checkbox"
                  defaultChecked
                  className="accent-brand-600"
                />
                {t("remember")}
              </label>
              <a
                href="/forgot"
                className="text-xs text-brand-700 hover:text-brand-800 underline"
              >
                {t("forgot")}
              </a>
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

            <button className="btn-primary w-full py-2.5">{t("submit")}</button>
          </form>

          <p className="text-[11px] text-slate-400 text-center mt-8">{tc("support")}</p>
          <p className="text-[11px] text-center mt-2">
            <a href="/kvkk" className="text-slate-500 hover:text-brand-700 underline">
              {t("privacy")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
