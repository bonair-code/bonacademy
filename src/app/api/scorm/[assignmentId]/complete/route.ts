import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.userId !== user.id) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  }
  await prisma.attempt.updateMany({
    where: { assignmentId: a.id, type: "SCORM", finishedAt: null },
    data: { finishedAt: new Date() },
  });
  await prisma.assignment.update({
    where: { id: a.id },
    data: { status: "SCORM_COMPLETED" },
  });
  return NextResponse.json({ ok: true });
}
