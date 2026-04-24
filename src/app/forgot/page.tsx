import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createPasswordToken } from "@/lib/passwordTokens";
import { sendResetEmail } from "@/lib/notifications/mailer";
import { verifyRecaptchaToken } from "@/lib/captcha";
import { RecaptchaV3 } from "@/components/RecaptchaV3";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { headers } from "next/headers";

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
    select: { id: true, name: true, isActive: true },
  });
  if (user && user.isActive) {
    try {
      const token = await createPasswordToken(user.id, "RESET");
      await sendResetEmail(email, user.name, token);
    } catch (err) {
      console.error("[forgot] mail failed for", email, err);
    }
  }
  redirect("/forgot?sent=1");
}

function msg(error?: string, sent?: string) {
  if (sent === "1")
    return {
      type: "ok" as const,
      text:
        "Eğer bu e-posta sistemimizde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi. " +
        "Bağlantı 2 saat geçerlidir. Mailinizi kontrol edin (spam dahil).",
    };
  switch (error) {
    case "captcha":
      return { type: "err" as const, text: "Güvenlik doğrulaması başarısız." };
    case "empty":
      return { type: "err" as const, text: "E-posta adresinizi girin." };
    case "rate":
      return {
        type: "err" as const,
        text: "Çok fazla istek. 15 dakika sonra tekrar deneyin.",
      };
    default:
      return null;
  }
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const m = msg(error, sent);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="card p-6 max-w-md w-full">
        <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
        <h1 className="text-xl font-semibold text-slate-900 mb-1">
          Şifremi Unuttum
        </h1>
        <p className="text-sm text-slate-600 mb-4">
          Hesabınıza ait e-postayı girin. Size 2 saat geçerli bir sıfırlama
          bağlantısı göndereceğiz. Hesabınız kilitliyse de aynı bağlantıyla
          açılır.
        </p>

        {m && (
          <p
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${
              m.type === "ok"
                ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                : "text-brand-700 bg-brand-50 border border-brand-200"
            }`}
          >
            {m.text}
          </p>
        )}

        {sent !== "1" && (
          <form action={requestReset} className="space-y-3">
            <div>
              <label className="label">E-posta</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="input mt-1"
                placeholder="ad.soyad@bonair.com.tr"
              />
            </div>
            <RecaptchaV3 action="forgot" />
            <button className="btn-primary w-full">Sıfırlama Bağlantısı Gönder</button>
          </form>
        )}

        <p className="text-[11px] text-slate-400 text-center mt-6">
          <a href="/login" className="underline hover:text-slate-600">
            Giriş sayfasına dön
          </a>
        </p>
      </div>
    </div>
  );
}
