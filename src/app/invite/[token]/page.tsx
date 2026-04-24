import { notFound, redirect } from "next/navigation";
import {
  consumePasswordToken,
  verifyPasswordToken,
} from "@/lib/passwordTokens";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PasswordField } from "@/components/PasswordField";

export const runtime = "nodejs";

// Davet linkiyle gelen kullanıcı buradan ilk şifresini kurar.
// Token tipi: INVITE, TTL 72 saat, tek kullanımlık. Geçersizse 404.

async function setupAccount(formData: FormData) {
  "use server";
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const row = await verifyPasswordToken(token, "INVITE");
  if (!row) redirect(`/invite/${token}?error=invalid`);
  if (password !== confirm) redirect(`/invite/${token}?error=mismatch`);
  const strengthErr = validatePasswordStrength(password);
  if (strengthErr) redirect(`/invite/${token}?error=weak`);
  const hash = await hashPassword(password);
  await prisma.user.update({
    where: { id: row.userId },
    data: { passwordHash: hash, failedLoginAttempts: 0, lockedAt: null },
  });
  await consumePasswordToken(row.id);
  await audit({
    actorId: row.userId,
    action: "user.invite.complete",
    entity: "User",
    entityId: row.userId,
    metadata: { email: row.user.email },
  });
  redirect("/login?invited=1");
}

function errMsg(c?: string) {
  switch (c) {
    case "invalid":
      return "Bağlantı geçersiz veya süresi dolmuş. Yöneticinizden yeni davet isteyin.";
    case "mismatch":
      return "Şifreler eşleşmiyor.";
    case "weak":
      return "Şifre en az 8 karakter olmalı ve harf + rakam içermeli.";
    default:
      return null;
  }
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
  const row = await verifyPasswordToken(token, "INVITE");
  const err = errMsg(error);
  if (!row && !err) notFound();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="card p-6 max-w-md w-full">
        <div className="h-1 w-10 bg-brand-600 rounded-full mb-3" />
        <h1 className="text-xl font-semibold text-slate-900 mb-1">
          BonAcademy hesabınızı kurun
        </h1>
        {row ? (
          <>
            <p className="text-sm text-slate-600 mb-4">
              Merhaba <strong>{row.user.name}</strong>, şifrenizi belirleyin.
              Bu bağlantı tek kullanımlıktır.
            </p>
            <form action={setupAccount} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <div>
                <label className="label">Yeni şifre</label>
                <PasswordField name="password" required autoComplete="new-password" />
              </div>
              <div>
                <label className="label">Şifre (tekrar)</label>
                <PasswordField name="confirm" required autoComplete="new-password" />
              </div>
              {err && (
                <p className="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                  {err}
                </p>
              )}
              <button className="btn-primary w-full">Şifreyi Kaydet ve Giriş Yap</button>
              <p className="text-[11px] text-slate-500 text-center">
                En az 8 karakter, harf ve rakam içermeli.
              </p>
            </form>
          </>
        ) : (
          <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}
