import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createPasswordToken } from "@/lib/passwordTokens";
import { sendResetEmail } from "@/lib/notifications/mailer";
import { verifyRecaptchaToken } from "@/lib/captcha";
import { RecaptchaV3 } from "@/components/RecaptchaV3";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

export const runtime = "nodejs";

// "Şifremi unuttum" — kullanıcı e-posta girer; varsa RESET token üretilip
// mail gider. Cevap her zaman jenerik ("e-posta varsa link gönderildi") ki
// e-posta varlığı sızdırılmasın. IP başına 5/15 dk sınırı.

async function requestReset(formData: FormData) {
  "use server";
  const h = await headers();
  const ip = clientIp(h);
  const rl = rateLimit(`forgot:${ip}`, 5, 15 * 60_000);
  if (!rl.ok) redirect("/forgot?error=rate");

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const captchaToken = String(formData.get("captchaToken") || "");
  const cap = await verifyRecaptchaToken(captchaToken, "forgot");
  if (!cap.ok) redirect("/forgot?error=captcha");
  if (!email) redirect("/forgot?error=empty");

  // E-posta varsa token üret + mail. Yoksa sessizce devam — yanıt aynı.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, isActive: true, locale: true },
  });
  if (user && user.isActive) {
    try {
      const token = await createPasswordToken(user.id, "RESET");
      await sendResetEmail(email, user.name, token, user.locale);
    } catch (err) {
      console.error("[forgot] mail failed for", email, err);
    }
  }
  redirect("/forgot?sent=1");
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const t = await getTranslations("forgot");

  let msg: { type: "ok" | "err"; text: string } | null = null;
  if (sent === "1") msg = { type: "ok", text: t("sent") };
  else if (error === "captcha") msg = { type: "err", text: t("error.captcha") };
  else if (error === "empty") msg = { type: "err", text: t("error.empty") };
  else if (error === "rate") msg = { type: "err", text: t("error.rate") };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 relative">
      <div className="absolute top-4 right-4">
        <LocaleSwitcher nextPath="/forgot" />
      </div>
      <div className="card p-6 max-w-md w-full">
        <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
        <h1 className="text-xl font-semibold text-slate-900 mb-1">{t("heading")}</h1>
        <p className="text-sm text-slate-600 mb-4">{t("intro")}</p>

        {msg && (
          <p
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              msg.type === "ok"
                ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                : "text-brand-700 bg-brand-50 border border-brand-200"
            }`}
          >
            {msg.text}
          </p>
        )}

        {sent !== "1" && (
          <form action={requestReset} className="space-y-3">
            <div>
              <label className="label">{t("email")}</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="input mt-1"
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <RecaptchaV3 action="forgot" />
            <button className="btn-primary w-full">{t("submit")}</button>
          </form>
        )}

        <p className="text-[11px] text-slate-400 text-center mt-6">
          <a href="/login" className="underline hover:text-slate-600">
            {t("backToLogin")}
          </a>
        </p>
      </div>
    </div>
  );
}
