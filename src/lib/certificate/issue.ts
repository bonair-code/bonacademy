import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";

export async function issueCertificate(assignmentId: string) {
  const existing = await prisma.certificate.findUnique({ where: { assignmentId } });
  if (existing) return existing;
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new Error("Assignment yok");
  const serial = `BA-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  return prisma.certificate.create({
    data: {
      assignmentId,
      userId: a.userId,
      pdfPath: "",
      serialNo: serial,
    },
  });
}
