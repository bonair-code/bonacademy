import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { renderTeamSummaryPdf } from "@/lib/reports/teamSummaryPdf";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireRole("MANAGER", "ADMIN");

  // Manager: yalnızca kendi raporları. Admin: tüm kullanıcılar.
  const where = user.role === "ADMIN" ? {} : { managerId: user.id };

  const members = await prisma.user.findMany({
    where,
    include: {
      department: { select: { name: true } },
      assignments: {
        include: { plan: { include: { course: { select: { title: true } } } } },
        orderBy: { dueDate: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const pdf = await renderTeamSummaryPdf({
    managerName: user.name || user.email,
    scopeLabel: user.role === "ADMIN" ? "Tüm Şirket" : "Ekibim",
    generatedAt: new Date(),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      department: m.department?.name ?? null,
      assignments: m.assignments.map((a) => ({
        id: a.id,
        courseTitle: a.plan.course.title,
        cycleNumber: a.cycleNumber,
        dueDate: a.dueDate,
        status: a.status,
      })),
    })),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ekibim-ozeti-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
