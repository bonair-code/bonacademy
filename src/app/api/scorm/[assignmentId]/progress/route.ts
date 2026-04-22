import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * Inspect the SCORM CMI payload for any completion signal.
 * - SCORM 1.2: cmi.core.lesson_status ∈ {completed, passed}
 * - SCORM 2004: cmi.completion_status === "completed" OR cmi.success_status === "passed"
 */
function cmiIndicatesCompletion(cmi: any): boolean {
  if (!cmi || typeof cmi !== "object") return false;
  const core = cmi.core ?? cmi.cmi?.core;
  const lessonStatus = core?.lesson_status ?? cmi.cmi?.core?.lesson_status;
  if (typeof lessonStatus === "string") {
    const v = lessonStatus.toLowerCase();
    if (v === "completed" || v === "passed") return true;
  }
  const completion = cmi.completion_status ?? cmi.cmi?.completion_status;
  if (typeof completion === "string" && completion.toLowerCase() === "completed") return true;
  const success = cmi.success_status ?? cmi.cmi?.success_status;
  if (typeof success === "string" && success.toLowerCase() === "passed") return true;
  return false;
}

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

  // Promote the assignment to SCORM_COMPLETED as soon as the content reports
  // completion, so learners whose packages never fire LMSFinish can still
  // reach the exam. The explicit /complete endpoint remains a fallback.
  if (
    (a.status === "PENDING" || a.status === "IN_PROGRESS") &&
    cmiIndicatesCompletion(body.cmi)
  ) {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "SCORM_COMPLETED" },
    });
    await prisma.attempt.updateMany({
      where: { assignmentId: a.id, type: "SCORM", finishedAt: null },
      data: { finishedAt: new Date() },
    });
    return NextResponse.json({ ok: true, completed: true });
  }

  return NextResponse.json({ ok: true });
}
