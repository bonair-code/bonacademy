import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// İlk kurulum sihirbazı — yalnızca DB'de henüz hiç ADMIN kullanıcı yokken
// erişilebilir. Bir admin oluşturulduktan sonra sayfa /login'e yönlendirir,
// böylece public kalsa bile kötü niyetli biri ikinci admin oluşturamaz.
//
// Ek koruma: prod'da ortam değişkeni SETUP_TOKEN tanımlanmışsa form bu token'ı
// ister. Lokal/staging'de ise tanımsız bırakılabilir.

async function createFirstAdmin(formData: FormData) {
  "use server";
  // Tekrar kontrol — race condition'a karşı.
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  if (adminCount > 0) {
    redirect("/login?setup=already");
  }

  const expectedToken = process.env.SETUP_TOKEN;
  const providedToken = String(formData.get("token") || "").trim();
  if (expectedToken && providedToken !== expectedToken) {
    redirect("/setup?err=token");
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !name || !password) {
    redirect("/setup?err=missing");
  }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) {
    redirect(`/setup?err=password&msg=${encodeURIComponent(pwErr)}`);
  }

  const passwordHash = await hashPassword(password);

  // Departmanı yoksa "Yönetim" oluştur — admin'i bir yere bağlamak gerek.
  const dep = await prisma.department.upsert({
    where: { name: "Yönetim" },
    update: {},
    create: { name: "Yönetim" },
  });

  const admin = await prisma.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      isActive: true,
      passwordHash,
      departmentId: dep.id,
    },
  });

  await audit({
    actorId: admin.id,
    action: "user.create",
    entity: "User",
    entityId: admin.id,
    metadata: { source: "setup-wizard", email },
  });

  redirect("/login?setup=ok");
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; msg?: string }>;
}) {
  // Halihazırda admin varsa setup'a hiç girilmesin — direkt login'e at.
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  if (adminCount > 0) redirect("/login?setup=already");

  const { err, msg } = await searchParams;
  const tokenRequired = !!process.env.SETUP_TOKEN;

  let errorMsg: string | null = null;
  if (err === "token") errorMsg = "Setup token hatalı.";
  else if (err === "missing") errorMsg = "Tüm alanlar zorunlu.";
  else if (err === "password")
    errorMsg = msg ? decodeURIComponent(msg) : "Şifre kuralları sağlanmadı.";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md card p-6">
        <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          BonAcademy — İlk Kurulum
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Bu sayfa yalnızca sistemde hiç yönetici yokken görüntülenir. İlk
          yönetici hesabını oluştur, sonrasında bu adres otomatik olarak giriş
          sayfasına yönlenir.
        </p>

        <form action={createFirstAdmin} className="space-y-4 mt-6">
          {tokenRequired && (
            <div>
              <label className="label">Setup Token</label>
              <input
                name="token"
                type="password"
                required
                className="input mt-1"
                placeholder="SETUP_TOKEN env değeri"
                autoComplete="off"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Vercel env'de SETUP_TOKEN tanımlı olduğu için bu alan zorunlu.
              </p>
            </div>
          )}
          <div>
            <label className="label">Ad Soyad</label>
            <input name="name" required className="input mt-1" />
          </div>
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
              autoComplete="new-password"
              className="input mt-1"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              En az 10 karakter, büyük harf, küçük harf, rakam ve özel karakter
              içermeli.
            </p>
          </div>

          {errorMsg && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <button className="btn-primary w-full">Yöneticiyi Oluştur</button>
        </form>
      </div>
    </div>
  );
}
