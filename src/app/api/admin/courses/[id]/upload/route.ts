import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { uploadScormZip } from "@/lib/scorm/uploadPackage";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Zip gerekli" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const result = await uploadScormZip(buf);
  const course = await prisma.course.update({
    where: { id },
    data: {
      scormPackagePath: result.packagePath,
      scormEntryPoint: result.entryPoint,
      scormVersion: result.version,
    },
  });
  return NextResponse.json(course);
}
