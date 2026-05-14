import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkIntegrationKey } from "@/lib/integration-auth";
import type { AssignmentStatus } from "@prisma/client";

// BonFlight (ve diğer iç sistemler) için salt-okunur eğitim kaydı API'sinin
// ortak çekirdeği. Hem kanonik /api/integration/training-records hem de
// catch-all /api/integration/[[...path]] bu fonksiyonu kullanır — böylece dış
// sistem URL'in sonuna ne eklerse eklesin aynı yanıt döner.
//
// Her kayıt bir Assignment'tır: "kim, hangi eğitimi, hangi durumda" + son
// sınav + sertifika. Dış sistem `status` alanına göre kategorize eder:
//   alıyor/alacak  → PENDING, IN_PROGRESS, SCORM_COMPLETED
//   almış          → COMPLETED, EXAM_PASSED  (sertifika varsa certificate dolu)
//   almamış/sorunlu → OVERDUE, EXAM_FAILED, RETAKE_REQUIRED
//
// Opsiyonel filtreler:
//   ?email=ad.soyad@bonair.com.tr   tek çalışan
//   ?status=COMPLETED               tek durum

const APP_URL =
  process.env.AUTH_URL || process.env.APP_URL || "http://localhost:3000";

const VALID_STATUSES = new Set<AssignmentStatus>([
  "PENDING",
  "IN_PROGRESS",
  "SCORM_COMPLETED",
  "EXAM_PASSED",
  "EXAM_FAILED",
  "RETAKE_REQUIRED",
  "COMPLETED",
  "OVERDUE",
]);

export async function handleTrainingRecords(req: NextRequest) {
  const authError = checkIntegrationKey(req);
  if (authError) return authError;

  const url = new URL(req.url);
  // Dış sistemin tam olarak hangi yolu çağırdığını görmek için logla.
  console.log(
    `[integration] training-records request: ${req.method} ${url.pathname}${url.search}`,
  );

  const emailFilter = url.searchParams.get("email")?.trim().toLowerCase();
  const statusRaw = url.searchParams.get("status")?.trim().toUpperCase();

  if (statusRaw && !VALID_STATUSES.has(statusRaw as AssignmentStatus)) {
    return NextResponse.json(
      { error: "Invalid status filter", validValues: [...VALID_STATUSES] },
      { status: 400 },
    );
  }

  const rows = await prisma.assignment.findMany({
    where: {
      ...(emailFilter ? { user: { email: emailFilter } } : {}),
      ...(statusRaw ? { status: statusRaw as AssignmentStatus } : {}),
    },
    include: {
      user: {
        include: {
          department: true,
          jobTitles: { include: { jobTitle: true } },
        },
      },
      plan: { include: { course: true } },
      examAttempts: { orderBy: { attemptNo: "desc" }, take: 1 },
      certificate: true,
    },
    orderBy: [{ user: { name: "asc" } }, { dueDate: "asc" }],
  });

  const records = rows.map((r) => {
    const latestExam = r.examAttempts[0] ?? null;
    // BonAcademy'de kurs kodu alanı yok — şimdilik başlığı kod olarak kullan.
    const code = r.plan.course.title;
    const dueDateStr = r.dueDate.toISOString().slice(0, 10);
    const completedStr = r.completedAt?.toISOString().slice(0, 10) ?? null;
    // BonFlight'ın CSV hücre modeli: geçerlilik tarihi / marker / boş.
    // Tamamlandıysa tamamlanma tarihi, değilse son tarih.
    const value = completedStr ?? dueDateStr;
    const certificate = r.certificate
      ? {
          serialNo: r.certificate.serialNo,
          issuedAt: r.certificate.issuedAt.toISOString(),
          verifyUrl: `${APP_URL}/verify/${r.certificate.serialNo}`,
        }
      : null;
    const exam = latestExam
      ? {
          attemptNo: latestExam.attemptNo,
          score: latestExam.score,
          passed: latestExam.passed,
        }
      : null;

    // NOT: Bu kayıt geçici olarak hem iç içe hem düz alan adlarıyla
    // (çoklu konvansiyon) döndürülüyor — BonFlight'ın hangi şekli beklediği
    // netleşene kadar tanı amaçlı. Sözleşme netleşince sadeleştirilecek.
    return {
      // --- iç içe (orijinal) ---
      assignmentId: r.id,
      employee: {
        id: r.user.id,
        name: r.user.name,
        email: r.user.email,
        department: r.user.department?.name ?? null,
        jobTitles: r.user.jobTitles.map((j) => j.jobTitle.name),
        isActive: r.user.isActive,
      },
      training: {
        courseId: r.plan.course.id,
        courseTitle: r.plan.course.title,
        courseCode: code,
        planId: r.planId,
      },
      latestExam: exam,
      certificate,
      // --- düz: kimlik ---
      email: r.user.email,
      employeeEmail: r.user.email,
      employee_email: r.user.email,
      employee_no: null,
      employeeNo: null,
      name: r.user.name,
      employeeName: r.user.name,
      employee_name: r.user.name,
      department: r.user.department?.name ?? null,
      jobTitles: r.user.jobTitles.map((j) => j.jobTitle.name),
      isActive: r.user.isActive,
      // --- düz: eğitim/kurs ---
      code,
      courseCode: code,
      course_code: code,
      trainingCode: code,
      training_code: code,
      courseTitle: r.plan.course.title,
      courseName: r.plan.course.title,
      course: r.plan.course.title,
      courseId: r.plan.course.id,
      planId: r.planId,
      // --- düz: durum & tarihler ---
      status: r.status,
      cycleNumber: r.cycleNumber,
      revisionNumber: r.revisionNumber,
      dueDate: r.dueDate.toISOString(),
      due_date: dueDateStr,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      completed_at: completedStr,
      completionDate: completedStr,
      completion_date: completedStr,
      validUntil: value,
      valid_until: value,
      expiryDate: value,
      expiry_date: value,
      value,
      date: value,
    };
  });

  // Durum bazlı özet — dış sistem hızlı kontrol için kullanabilir.
  const summary: Record<string, number> = {};
  for (const r of records) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
  }

  // Tanı amaçlı çoklu-konvansiyon yanıt: dizi birçok yaygın anahtar altında.
  // BonFlight'ın "Alındı: 0" sorunu yanıt şekli uyumsuzluğundan; hangi anahtarı
  // okuduğu netleşince yanıt tek temiz şekle indirilecek.
  return NextResponse.json(
    {
      ok: true,
      success: true,
      generatedAt: new Date().toISOString(),
      count: records.length,
      summary,
      records,
      data: records,
      items: records,
      results: records,
      rows: records,
      trainingRecords: records,
      training_records: records,
      assignments: records,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
