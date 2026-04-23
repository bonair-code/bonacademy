import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { ensureExamSession } from "@/lib/exam/engine";
import { ExamForm } from "./ExamForm";
import { ExamAttemptsDrawer } from "@/components/ExamAttemptsDrawer";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: {
        include: {
          course: {
            include: {
              exam: true,
              questionBank: { include: { questions: { include: { options: true } } } },
            },
          },
        },
      },
      examAttempts: true,
    },
  });
  if (!a || a.userId !== user.id) notFound();
  if (a.status === "RETAKE_REQUIRED") redirect(`/course/${a.id}`);
  if (a.status === "EXAM_PASSED" || a.status === "COMPLETED") redirect("/dashboard");
  // Gate: user must actually finish the SCORM content before taking the exam.
  // PENDING / IN_PROGRESS here means the SCORM player never reported completion.
  if (a.status === "PENDING" || a.status === "IN_PROGRESS") {
    redirect(`/course/${a.id}?needsCompletion=1`);
  }

  const bank = a.plan.course.questionBank;
  let exam = a.plan.course.exam;
  // Soru bankası dolu ama Exam kaydı daha önce oluşturulmamış olabilir
  // (eski kurslarda bu durum vardı). Bankada soru varsa varsayılan bir
  // sınav kaydı üret; yoksa gerçekten tanımlı değil.
  if (bank && bank.questions.length > 0 && !exam) {
    exam = await prisma.exam.create({
      data: {
        courseId: a.plan.course.id,
        questionCount: Math.min(10, bank.questions.length),
        passingScore: a.plan.course.passingScore ?? 70,
      },
    });
  }
  if (!bank || bank.questions.length === 0 || !exam) {
    return (
      <Shell user={user}>
        <p>Bu kurs için sınav tanımlı değil.</p>
      </Shell>
    );
  }

  // Server-side snapshot: bu denemeye ait soru kümesini ExamSession'a yaz.
  // Sayfa yenilense de aynı sorular gelir; submit ise bu snapshot'a göre
  // puanlanır — istemci hiçbir soruyu "atlayarak" puan manipüle edemez.
  const attemptNo = a.examAttempts.length + 1;
  const session = await ensureExamSession({
    assignmentId: a.id,
    attemptNo,
    bankQuestionIds: bank.questions.map((q) => q.id),
    questionCount: exam.questionCount,
    shuffle: exam.shuffle,
  });
  const qById = new Map(bank.questions.map((q) => [q.id, q]));
  const picked = session.questionIds
    .map((id) => qById.get(id))
    .filter((q): q is (typeof bank.questions)[number] => !!q)
    .map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    }));

  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-1">{a.plan.course.title} — Sınav</h1>
      <p className="text-sm text-slate-500 mb-4">
        Geçme notu: %{exam.passingScore}. Deneme: {a.examAttempts.length + 1}/2
      </p>
      <ExamForm assignmentId={a.id} sessionId={session.id} questions={picked} />
      {a.examAttempts.length > 0 && (
        <div className="mt-6">
          <ExamAttemptsDrawer
            attempts={a.examAttempts.map((e) => ({
              id: e.id,
              attemptNo: e.attemptNo,
              score: e.score,
              passed: e.passed,
              finishedAt: e.createdAt ? e.createdAt.toISOString() : null,
            }))}
          />
        </div>
      )}
    </Shell>
  );
}
