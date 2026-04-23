import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { uploadScormZip } from "@/lib/scorm/uploadPackage";
import {
  createCourseRevision,
  ensureBaselineRevision,
} from "@/lib/courseRevisions";
import { deletePackage } from "@/lib/scorm/storage";

export const runtime = "nodejs";

// SCORM paketleri büyük olabilir ama sunucuyu korumak için sert bir tavan belirliyoruz.
const MAX_SCORM_ZIP_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_CHANGE_NOTE_LENGTH = 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("ADMIN");
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  const rawNote = String(form.get("changeNote") || "").trim();
  const changeNote = rawNote ? rawNote.slice(0, MAX_CHANGE_NOTE_LENGTH) : undefined;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Zip gerekli" }, { status: 400 });
  }
  if (file.size > MAX_SCORM_ZIP_BYTES) {
    return NextResponse.json(
      { error: `Dosya çok büyük (maks ${Math.round(MAX_SCORM_ZIP_BYTES / 1024 / 1024)} MB)` },
      { status: 413 }
    );
  }

  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Kurs yok" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await uploadScormZip(buf);

  // Baseline snapshot for courses that pre-date the revision system. Do this
  // *before* mutating the course row so v1 captures the previous state.
  await ensureBaselineRevision(existing, admin.id);

  const previousPackagePath = existing.scormPackagePath;

  const course = await prisma.course.update({
    where: { id },
    data: {
      scormPackagePath: result.packagePath,
      scormEntryPoint: result.entryPoint,
      scormVersion: result.version,
    },
  });

  // Every SCORM replacement is a content change, so bump the revision.
  await createCourseRevision(
    id,
    admin.id,
    changeNote ?? `SCORM paketi güncellendi (${file.name})`
  );

  // Clean up the old package from blob storage. Best-effort — don't fail
  // the request if the store is transiently unavailable.
  if (previousPackagePath && previousPackagePath !== result.packagePath) {
    try {
      await deletePackage(previousPackagePath);
    } catch {}
  }

  return NextResponse.json(course);
}
