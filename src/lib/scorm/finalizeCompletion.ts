import { prisma } from "@/lib/db";
import { issueCertificate } from "@/lib/certificate/issue";

/**
 * SCORM içeriği tamamlandığında çağrılır.
 * - Kursta soru bankası + sınav tanımlı ve içinde soru varsa:
 *   atama SCORM_COMPLETED'a geçer (kullanıcı sınava yönlendirilir).
 * - Sınav tanımlı değilse (soru bankası boş veya yok):
 *   atama doğrudan COMPLETED olarak işaretlenir ve katılım sertifikası üretilir.
 */
export async function finalizeScormCompletion(assignmentId: string) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: {
        include: {
          course: {
            include: {
              exam: true,
              questionBank: {
                include: { _count: { select: { questions: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!a) return;

  const hasExam =
    !!a.plan.course.exam &&
    !!a.plan.course.questionBank &&
    a.plan.course.questionBank._count.questions > 0;

  await prisma.attempt.updateMany({
    where: { assignmentId: a.id, type: "SCORM", finishedAt: null },
    data: { finishedAt: new Date() },
  });

  if (hasExam) {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "SCORM_COMPLETED" },
    });
    return { status: "SCORM_COMPLETED" as const, certificateIssued: false };
  }

  // Sınav yok → katılım sertifikası ile eğitimi bitir.
  await prisma.assignment.update({
    where: { id: a.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await issueCertificate(a.id);
  return { status: "COMPLETED" as const, certificateIssued: true };
}
