import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

// Kursların Excel dışa aktarımı. ADMIN tüm kursları, MANAGER ise yalnızca
// sorumlu olduğu kursları görür (least-privilege). Bir MANAGER başka
// yöneticilerin SCORM/sınav ayrıntılarını veya atama sayılarını görmemeli.
export async function GET() {
  const me = await requireRole("ADMIN", "MANAGER");
  const scopeWhere =
    me.role === "MANAGER" ? { ownerManagerId: me.id } : undefined;

  const courses = await prisma.course.findMany({
    where: scopeWhere,
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
    include: {
      ownerManager: { select: { name: true, email: true } },
      exam: { select: { questionCount: true, passingScore: true } },
      questionBank: { include: { _count: { select: { questions: true } } } },
      _count: { select: { plans: true } },
    },
  });

  // Atama sayıları — kurs → plan → assignment ilişkisini tek sorguda toplayalım
  // ki N+1 olmasın.
  const planRows = await prisma.trainingPlan.findMany({
    select: { courseId: true, _count: { select: { assignments: true } } },
  });
  const assignmentsByCourse = new Map<string, number>();
  for (const p of planRows) {
    assignmentsByCourse.set(
      p.courseId,
      (assignmentsByCourse.get(p.courseId) ?? 0) + p._count.assignments
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "BonAcademy";
  wb.created = new Date();
  const sheet = wb.addWorksheet("Kurslar", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Başlık", key: "title", width: 40 },
    { header: "Açıklama", key: "description", width: 50 },
    { header: "Durum", key: "status", width: 10 },
    { header: "Revizyon", key: "rev", width: 10 },
    { header: "Sorumlu Yönetici", key: "owner", width: 25 },
    { header: "Sorumlu E-posta", key: "ownerEmail", width: 30 },
    { header: "SCORM Paketi", key: "scorm", width: 14 },
    { header: "SCORM Sürümü", key: "scormVersion", width: 14 },
    { header: "Geçme Skoru (%)", key: "pass", width: 14 },
    { header: "Sınav Soru Sayısı", key: "qcount", width: 16 },
    { header: "Bankadaki Soru", key: "bankCount", width: 14 },
    { header: "Süre (dk)", key: "duration", width: 10 },
    { header: "Plan Sayısı", key: "plans", width: 12 },
    { header: "Toplam Atama", key: "assignments", width: 14 },
    { header: "Oluşturulma", key: "createdAt", width: 18 },
    { header: "Güncellenme", key: "updatedAt", width: 18 },
  ];

  // Başlık satırını belirginleştir.
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const c of courses) {
    sheet.addRow({
      title: c.title,
      description: c.description ?? "",
      status: c.isActive ? "Aktif" : "Pasif",
      rev: `v${c.currentRevision}`,
      owner: c.ownerManager?.name ?? "—",
      ownerEmail: c.ownerManager?.email ?? "",
      scorm: c.scormPackagePath ? "Yüklü" : "Yok",
      scormVersion: c.scormVersion === "SCORM_12" ? "SCORM 1.2" : "SCORM 2004",
      pass: c.exam?.passingScore ?? c.passingScore,
      qcount: c.exam?.questionCount ?? "",
      bankCount: c.questionBank?._count.questions ?? 0,
      duration: c.durationMinutes ?? "",
      plans: c._count.plans,
      assignments: assignmentsByCourse.get(c.id) ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
  }

  // Tarih hücrelerini yerelleştirilmiş biçimde göster.
  sheet.getColumn("createdAt").numFmt = "dd.mm.yyyy hh:mm";
  sheet.getColumn("updatedAt").numFmt = "dd.mm.yyyy hh:mm";
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  const buffer = await wb.xlsx.writeBuffer();
  const ymd = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kurslar-${ymd}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
