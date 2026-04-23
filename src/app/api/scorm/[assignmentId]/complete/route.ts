import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { finalizeScormCompletion } from "@/lib/scorm/finalizeCompletion";

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
  const result = await finalizeScormCompletion(a.id);
  return NextResponse.json({ ok: true, ...result });
}
