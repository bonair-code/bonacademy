import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { getFile } from "@/lib/scorm/storage";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// SCORM içeriği yalnızca paketi içeren kursa geçerli ataması/denemesi olan
// kullanıcılara sunulur. Admin/yönetici her zaman erişebilir. Böylece paket
// yolu tahmin edilse bile yetkisiz kullanıcı içeriği indiremez.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const user = await requireUser();
  const { path } = await params;
  const blobPath = path.join("/");
  // Paket kimliği = ilk segment (uploadScormZip randomUUID üretiyor).
  const packageId = path[0];
  if (!packageId) {
    return new NextResponse("Bad request", { status: 400 });
  }

  // ADMIN her pakete, MANAGER kendi sahibi olduğu kursa, USER bu pakete
  // bağlı bir ataması olduğu sürece erişir.
  let authorized = false;
  if (user.role === "ADMIN") {
    authorized = true;
  } else {
    const course = await prisma.course.findFirst({
      where: { scormPackagePath: packageId },
      select: { id: true, ownerManagerId: true },
    });
    if (!course) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (user.role === "MANAGER" && course.ownerManagerId === user.id) {
      authorized = true;
    } else {
      const assignment = await prisma.assignment.findFirst({
        where: { userId: user.id, plan: { courseId: course.id } },
        select: { id: true },
      });
      authorized = !!assignment;
    }
  }
  if (!authorized) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const file = await getFile(blobPath);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.body as unknown as ArrayBuffer), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=600",
    },
  });
}
