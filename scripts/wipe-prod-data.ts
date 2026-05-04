/**
 * Production veri sıfırlama — kullanıcılara açmadan önce bir kez çalıştırılır.
 *
 * KORUNAN:
 *   - role=ADMIN kullanıcılar
 *   - Department, JobTitle, AppOption (Ayarlar modülü)
 *   - OrganizationSettings (sertifika şablonu)
 *
 * SİLİNEN:
 *   - Tüm kurslar (SCORM yolları DB'den, blob storage manuel temizlenmeli)
 *   - Soru bankası, sorular, seçenekler, sınavlar, sınav denemeleri
 *   - Eğitim planları, atamalar, ataması, denemeler
 *   - Sertifikalar
 *   - Bildirim kayıtları, password token'lar, audit log
 *   - ADMIN olmayan kullanıcılar (USER, MANAGER) ve onların job-title bağları
 *
 * Çalıştırma:
 *   1. vercel env pull --environment=production .env.production
 *   2. cp .env.production .env  (veya: DATABASE_URL=$(grep DATABASE_URL .env.production | cut -d= -f2-) npx tsx scripts/wipe-prod-data.ts)
 *   3. CONFIRM_WIPE=YES npx tsx scripts/wipe-prod-data.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_WIPE !== "YES") {
    console.error(
      "Güvenlik kontrolü: CONFIRM_WIPE=YES ortam değişkeni ile çalıştır."
    );
    process.exit(1);
  }

  // ---- BEFORE snapshot ----
  const before = {
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
  console.log("BEFORE:", before);

  // ---- DELETE in FK-safe order ----
  await prisma.$transaction(
    async (tx) => {
      // Audit log silinmeden önce: admin aksiyonları gitsin (yeni başlangıç).
      await tx.auditLog.deleteMany({});

      // Eğitim akışı (assignment ve descendants)
      await tx.examSession.deleteMany({});
      await tx.examAttempt.deleteMany({});
      await tx.attempt.deleteMany({});
      await tx.certificate.deleteMany({});
      await tx.assignment.deleteMany({});

      // Plan tarafı
      await tx.trainingPlanJobTitle.deleteMany({});
      await tx.trainingPlan.deleteMany({});

      // Kurs içeriği
      await tx.answerOption.deleteMany({});
      await tx.question.deleteMany({});
      await tx.questionBank.deleteMany({});
      await tx.exam.deleteMany({});
      await tx.courseRevision.deleteMany({});
      await tx.course.deleteMany({});

      // Bildirim & token
      await tx.notification.deleteMany({});
      await tx.passwordToken.deleteMany({});

      // ADMIN olmayan kullanıcı bağları
      await tx.userJobTitle.deleteMany({
        where: { user: { role: { not: "ADMIN" } } },
      });

      // ADMIN'lerin manager'ı non-admin olabilir → önce yöneticileri temizle.
      await tx.user.updateMany({
        where: { role: "ADMIN", managerId: { not: null } },
        data: { managerId: null },
      });

      // Diğer kullanıcılar arasındaki manager döngülerini de boşalt
      await tx.user.updateMany({
        where: { role: { not: "ADMIN" } },
        data: { managerId: null },
      });

      // Non-admin kullanıcıları sil
      await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } });
    },
    { timeout: 60_000 }
  );

  // ---- AFTER snapshot ----
  const after = {
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
  console.log("AFTER:", after);
  console.log("✓ Wipe complete.");
  console.log(
    "Hatırlatma: Vercel Blob altındaki SCORM paketleri DB'den koparıldı; Vercel Dashboard → Storage'dan elle silinebilir."
  );
}

main()
  .catch((e) => {
    console.error("WIPE FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
