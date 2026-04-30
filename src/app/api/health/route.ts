import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activeBackend } from "@/lib/scorm/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public health endpoint — Vercel/uptime izleyicilerin pingleyeceği yer.
// Kasıtlı olarak kimlik doğrulama istemez; yalnızca yapılandırma ve DB
// erişiminin sağlıklı olduğunu döner. Bilgi sızdırmamak için detayları
// minimize ediyoruz: env'lerin gerçek değeri değil, sadece boolean varlıkları.
//
// 200 → her şey OK (DB ping başarılı, kritik env'ler tanımlı)
// 503 → en az bir kritik bağımlılık eksik veya DB ulaşılmıyor

const REQUIRED_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXT_PUBLIC_RECAPTCHA_SITE_KEY",
  "RECAPTCHA_SECRET_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "CRON_SECRET",
];

export async function GET() {
  const env: Record<string, boolean> = {};
  for (const k of REQUIRED_ENV) env[k] = !!process.env[k];

  const azureSso =
    !!process.env.AUTH_AZURE_AD_CLIENT_ID &&
    !!process.env.AUTH_AZURE_AD_CLIENT_SECRET &&
    !!process.env.AUTH_AZURE_AD_TENANT_ID;

  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "unknown";
  }

  const allEnvOk = Object.values(env).every(Boolean);
  const overallOk = dbOk && allEnvOk;

  return NextResponse.json(
    {
      ok: overallOk,
      db: { ok: dbOk, error: dbError },
      env,
      azureSsoConfigured: azureSso,
      storageBackend: activeBackend(),
      timestamp: new Date().toISOString(),
    },
    { status: overallOk ? 200 : 503 }
  );
}
