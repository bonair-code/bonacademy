import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function GET() {
  await requireRole("ADMIN");
  const rows = await prisma.assignment.findMany({
    include: {
      user: { include: { department: true } },
      plan: { include: { course: true } },
      examAttempts: { orderBy: { attemptNo: "desc" }, take: 1 },
    },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Atamalar");
  ws.columns = [
    { header: "Kullanıcı", key: "user", width: 24 },
    { header: "E-posta", key: "email", width: 28 },
    { header: "Departman", key: "dep", width: 18 },
    { header: "Kurs", key: "course", width: 30 },
    { header: "Döngü", key: "cycle", width: 8 },
    { header: "Durum", key: "status", width: 16 },
    { header: "Son Tarih", key: "due", width: 14 },
    { header: "Tamamlanma", key: "completed", width: 14 },
    { header: "Son Sınav Puanı", key: "score", width: 14 },
  ];
  for (const r of rows) {
    ws.addRow({
      user: r.user.name,
      email: r.user.email,
      dep: r.user.department?.name ?? "",
      course: r.plan.course.title,
      cycle: r.cycleNumber,
      status: r.status,
      due: r.dueDate.toLocaleDateString("tr-TR"),
      completed: r.completedAt?.toLocaleDateString("tr-TR") ?? "",
      score: r.examAttempts[0]?.score?.toFixed(1) ?? "",
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as Buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="atamalar-${Date.now()}.xlsx"`,
    },
  });
}
