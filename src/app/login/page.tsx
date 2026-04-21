import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifySliderToken } from "@/lib/captcha";
import { SliderCaptcha } from "@/components/SliderCaptcha";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

const LOGIN_BYPASS = false;

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
  const remember = formData.get("remember") === "on";

  if (!verifySliderToken(captchaToken)) return redirect("/login?error=captcha");
  if (!email || !password) return redirect("/login?error=empty");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return redirect("/login?error=bad");
  }
  if (user.lockedAt) {
    return redirect("/login?error=locked");
  }

  try {
    await signIn("password", { email, password, redirect: false });
  } catch {
    // Fall through — check DB state below
  }

  const after = await prisma.user.findUnique({
    where: { email },
    select: { failedLoginAttempts: true, lockedAt: true },
  });
  if (after?.lockedAt) return redirect("/login?error=locked");
  if (after && after.failedLoginAttempts > 0) {
    const left = Math.max(0, MAX_ATTEMPTS - after.failedLoginAttempts);
    return redirect(`/login?error=bad&left=${left}`);
  }

  if (!remember) {
    const jar = await cookies();
    const names = [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
    ];
    for (const n of names) {
      const c = jar.get(n);
      if (c) {
        jar.set(n, c.value, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
      }
    }
  }

  redirect("/dashboard");
}

function errorText(code?: string, left?: string): string | null {
  switch (code) {
    case "captcha":
      return "Güvenlik doğrulaması yapılmadı veya süresi doldu.";
    case "empty":
      return "E-posta ve şifre zorunlu.";
    case "bad":
      return `E-posta veya şifre hatalı.${left ? ` Kalan deneme: ${left}` : ""}`;
    case "locked":
      return "Hesabınız 3 hatalı denemeden dolayı kilitlendi. Yöneticinize başvurun.";
    default:
      return null;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    left?: string;
  }>;
}) {
  if (LOGIN_BYPASS) redirect("/dashboard");
  const { error, left } = await searchParams;
  const msg = errorText(error, left);

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="hidden lg:flex relative overflow-hidden bg-slate-900 text-white p-12 flex-col justify-between">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #e31e24 0%, transparent 45%), radial-gradient(circle at 80% 70%, #e31e24 0%, transparent 40%)",
          }}
        />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo.png" alt="Bon Air" className="h-8 w-auto" />
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <div className="h-1 w-14 bg-brand-600 rounded-full mb-6" />
          <h2 className="text-3xl font-semibold tracking-tight leading-tight mb-3">
            Havacılıkta uyum, eğitimle başlar.
          </h2>
          <p className="text-slate-300 text-sm leading-relaxed">
            BonAcademy, Bon Air çalışanlarının zorunlu eğitimlerini planlar,
            SCORM içeriklerini oynatır, sınavları yönetir ve sertifikaları
            otomatik üretir.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-xs">
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">SCORM</div>
              <div className="text-slate-400">1.2 & 2004 desteği</div>
            </div>
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">Otomatik</div>
              <div className="text-slate-400">Tekrar eden planlar</div>
            </div>
            <div className="border border-white/10 rounded-lg p-3">
              <div className="text-brand-400 font-semibold text-lg">Sertifika</div>
              <div className="text-slate-400">PDF + takvim (ICS)</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 text-[11px] text-slate-500 tracking-wide">
          © {new Date().getFullYear()} Bon Air Havacılık
        </div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo.png" alt="Bon Air" className="h-12 w-auto mb-2" />
          </div>

          <div className="mb-8">
            <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Hesabınıza giriş yapın
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              BonAcademy — Eğitim Yönetim Sistemi
            </p>
          </div>

          {azureConfigured && (
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
              }}
              className="mb-4"
            >
              <button className="btn-secondary w-full">
                Microsoft 365 ile Giriş Yap
              </button>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400">
                  veya
                </span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            </form>
          )}

          <form action={loginAction} className="space-y-4">
            <div>
              <label className="label">E-posta</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                className="input mt-1"
                placeholder="ad.soyad@bonair.com.tr"
              />
            </div>
            <div>
              <label className="label">Şifre</label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="input mt-1"
                placeholder="••••••••"
              />
            </div>

            <SliderCaptcha />

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                name="remember"
                type="checkbox"
                defaultChecked
                className="accent-brand-600"
              />
              Beni hatırla
            </label>

            {msg && (
              <p className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                {msg}
              </p>
            )}

            <button className="btn-primary w-full py-2.5">Giriş Yap</button>
          </form>

          <p className="text-[11px] text-slate-400 text-center mt-8">
            Sorun yaşıyorsanız BT destek ile iletişime geçin.
          </p>
        </div>
      </div>
    </div>
  );
}
