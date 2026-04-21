import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { getFile } from "@/lib/scorm/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  await requireUser();
  const { path } = await params;
  const blobPath = path.join("/");
  const file = await getFile(blobPath);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=600",
    },
  });
}
