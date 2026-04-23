import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { submitExam } from "@/lib/exam/engine";
import { issueCertificate } from "@/lib/certificate/issue";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
  const body = (await req.json()) as {
    answers: Record<string, string[]>;
    sessionId?: string;
  };
  let result;
  try {
    result = await submitExam({
      assignmentId,
      sessionId: body.sessionId,
      answers: body.answers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sınav gönderilemedi";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (result.passed) {
    await issueCertificate(assignmentId);
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED" },
    });
  }
  // Dashboard ve eğitim sayfalarında durum güncel görünsün.
  revalidatePath("/dashboard");
  revalidatePath(`/course/${assignmentId}`);
  revalidatePath(`/exam/${assignmentId}`);
  return NextResponse.json(result);
}
