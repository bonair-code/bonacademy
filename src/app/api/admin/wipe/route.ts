import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEK SEFERLİK veri sıfırlama endpoint'i. Kullanıcılara açmadan önce çağrılır.
// SETUP_TOKEN env'i ile korunur (header: Authorization: Bearer <SETUP_TOKEN>)
// ve yalnızca sistemde HİÇ ADMIN OLMAYAN kullanıcı varken çalışır — yani
// kurulumdan önce bir kere. Aksi durumda 423 Locked döner.
//
// KORUNAN:
//   - Tüm ADMIN kullanıcılar
//   - Department, JobTitle, AppOption (ayarlar)
//   - OrganizationSettings (sertifika şablonu)
//
// SİLİNEN: kurslar, planlar, atamalar, denemeler, sertifikalar, bildirimler,
// audit log, password token'lar, ADMIN olmayan kullanıcılar.

export async function POST(req: NextRequest) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "SETUP_TOKEN tanımlı değil" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization");
  const provided = auth?.replace(/^Bearer\s+/i, "").trim();
  if (provided !== expected) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  if (adminCount === 0) {
    return NextResponse.json(
      { error: "Önce /setup üzerinden bir admin oluştur" },
      { status: 423 }
    );
  }

  const before = await collectCounts();

  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.deleteMany({});
      await tx.examSession.deleteMany({});
      await tx.examAttempt.deleteMany({});
      await tx.attempt.deleteMany({});
      await tx.certificate.deleteMany({});
      await tx.assignment.deleteMany({});
      await tx.trainingPlanJobTitle.deleteMany({});
      await tx.trainingPlan.deleteMany({});
      await tx.answerOption.deleteMany({});
      await tx.question.deleteMany({});
      await tx.questionBank.deleteMany({});
      await tx.exam.deleteMany({});
      await tx.courseRevision.deleteMany({});
      await tx.course.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.passwordToken.deleteMany({});
      await tx.userJobTitle.deleteMany({
        where: { user: { role: { not: "ADMIN" } } },
      });
      // Self-relation manager bağlarını çöz, sonra non-admin kullanıcıları sil
      await tx.user.updateMany({
        where: { managerId: { not: null } },
        data: { managerId: null },
      });
      await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } });
    },
    { timeout: 60_000 }
  );

  const after = await collectCounts();
  return NextResponse.json({ ok: true, before, after });
}

async function collectCounts() {
  return {
    users: await prisma.user.count(),
    admins: await prisma.user.count({ where: { role: "ADMIN" } }),
    departments: await prisma.department.count(),
    jobTitles: await prisma.jobTitle.count(),
    appOptions: await prisma.appOption.count(),
    courses: await prisma.course.count(),
    plans: await prisma.trainingPlan.count(),
    assignments: await prisma.assignment.count(),
    attempts: await prisma.attempt.count(),
    examAttempts: await prisma.examAttempt.count(),
    certificates: await prisma.certificate.count(),
    notifications: await prisma.notification.count(),
    auditLogs: await prisma.auditLog.count(),
    passwordTokens: await prisma.passwordToken.count(),
    courseRevisions: await prisma.courseRevision.count(),
    organizationSettings: await prisma.organizationSettings.count(),
  };
}
