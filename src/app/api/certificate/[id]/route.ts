import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { renderCertificatePdf } from "@/lib/certificate/pdf";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await requireUser();
  const { id } = await params;
  const cert = await prisma.certificate.findUnique({
    where: { id },
    include: {
      user: true,
      assignment: { include: { plan: { include: { course: true } } } },
    },
  });
  if (!cert) return new NextResponse("Not found", { status: 404 });
  if (viewer.role !== "ADMIN" && cert.userId !== viewer.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const pdf = await renderCertificatePdf({
    name: cert.user.name,
    courseTitle: cert.assignment.plan.course.title,
    issuedAt: cert.issuedAt,
    serialNo: cert.serialNo,
  });
  return new NextResponse(new Uint8Array(pdf as unknown as ArrayBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sertifika-${cert.serialNo}.pdf"`,
    },
  });
}
