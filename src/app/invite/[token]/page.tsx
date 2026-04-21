import { prisma } from "@/lib/db";
import { consumePasswordToken, hashPassword, markTokenUsed, validatePasswordStrength } from "@/lib/password";
import { redirect } from "next/navigation";

async function setPassword(formData: FormData) {
  "use server";
  const token = String(formData.get("token") || "");
  const pw = String(formData.get("password") || "");
  const pw2 = String(formData.get("password2") || "");
  if (pw !== pw2) return redirect(`/invite/${token}?error=match`);
  const err = validatePasswordStrength(pw);
  if (err) return redirect(`/invite/${token}?error=${encodeURIComponent(err)}`);
  const t = await consumePasswordToken(token);
  if (!t) return redirect(`/invite/${token}?error=invalid`);
  await prisma.user.update({
    where: { id: t.userId },
    data: { passwordHash: await hashPassword(pw), failedLoginAttempts: 0, lockedAt: null },
  });
  await markTokenUsed(t.id);
  redirect("/login?invited=1");
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const t = await consumePasswordToken(token);
  if (!t) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl p-8 max-w-md">
          <h1 className="text-xl font-semibold mb-2">Davet geçersiz</h1>
          <p className="text-sm text-slate-500">
            Bu davet bağlantısı geçersiz veya süresi dolmuş. Lütfen yöneticinizden yeni bir davet isteyin.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white border rounded-2xl p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold mb-1">Hesabınızı etkinleştirin</h1>
        <p className="text-sm text-slate-500 mb-4">Yeni şifrenizi belirleyin.</p>
        <form action={setPassword} className="space-y-3 text-sm">
          <input type="hidden" name="token" value={token} />
          <label className="block">
            Şifre
            <input name="password" type="password" required className="border rounded-lg px-3 py-2 w-full mt-1" />
          </label>
          <label className="block">
            Şifre (tekrar)
            <input name="password2" type="password" required className="border rounded-lg px-3 py-2 w-full mt-1" />
          </label>
          {error && <p className="text-xs text-red-600">{decodeURIComponent(error)}</p>}
          <button className="w-full bg-slate-900 text-white rounded-lg py-2.5">Şifreyi belirle</button>
        </form>
      </div>
    </div>
  );
}
