import { prisma } from "@/lib/db";
import { createPasswordToken } from "@/lib/password";
import { sendResetEmail } from "@/lib/notifications/mailer";
import { redirect } from "next/navigation";

async function submit(formData: FormData) {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.isActive) {
      const token = await createPasswordToken(user.id, "RESET", 2);
      await sendResetEmail(user.email, user.name, token);
    }
  }
  redirect("/forgot?sent=1");
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white border rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-1">Şifremi unuttum</h1>
        <p className="text-sm text-slate-500 mb-4">
          E-postanızı girin; kayıtlıysa sıfırlama bağlantısı göndereceğiz.
        </p>
        {sent ? (
          <p className="text-sm text-green-700">
            İşlem yapıldı. E-postanızı kontrol edin.
          </p>
        ) : (
          <form action={submit} className="space-y-3 text-sm">
            <label className="block">
              E-posta
              <input name="email" type="email" required className="border rounded-lg px-3 py-2 w-full mt-1" />
            </label>
            <button className="w-full bg-slate-900 text-white rounded-lg py-2.5">Sıfırlama bağlantısı gönder</button>
          </form>
        )}
      </div>
    </div>
  );
}
