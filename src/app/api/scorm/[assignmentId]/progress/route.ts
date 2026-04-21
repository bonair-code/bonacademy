import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!a || a.userId !== user.id) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  }
  const body = (await req.json()) as { cmi: unknown };
  const existing = await prisma.attempt.findFirst({
    where: { assignmentId: a.id, type: "SCORM", finishedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (existing) {
    await prisma.attempt.update({
      where: { id: existing.id },
      data: { cmiData: body.cmi as any },
    });
  } else {
    await prisma.attempt.create({
      data: { assignmentId: a.id, type: "SCORM", cmiData: body.cmi as any },
    });
  }
  return NextResponse.json({ ok: true });
}
