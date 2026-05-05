import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEK SEFERLİK admin şifre sıfırlama. SETUP_TOKEN ile korunur.
// POST body: { email: string, password: string }
// Bu endpoint açılışta /api/admin/wipe gibi geçici kullanımlıdır;
// kullanıldıktan sonra repo'dan silinmeli.

export async function POST(req: NextRequest) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "SETUP_TOKEN tanımlı değil" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "").trim();
  if (provided !== expected) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json({ error: "email ve password zorunlu" }, { status: 400 });
  }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) {
    return NextResponse.json({ error: pwErr }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Bu email'de admin yok" }, { status: 404 });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, failedLoginAttempts: 0, lockedAt: null },
  });

  return NextResponse.json({ ok: true, email, name: user.name });
}
