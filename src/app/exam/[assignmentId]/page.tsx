import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { pickQuestions } from "@/lib/exam/engine";
import { ExamForm } from "./ExamForm";

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
  const exam = a.plan.course.exam;
  if (!bank || !exam) {
    return (
      <Shell user={user}>
        <p>Bu kurs için sınav tanımlı değil.</p>
      </Shell>
    );
  }

  const picked = pickQuestions(bank.questions, exam.questionCount, exam.shuffle).map((q) => ({
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
      {a.examAttempts.length > 0 && (
        <div className="card p-3 mb-4 text-sm">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
            Önceki denemeler
          </div>
          <ul className="space-y-1">
            {a.examAttempts
              .slice()
              .sort((a, b) => b.attemptNo - a.attemptNo)
              .map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="badge-teal text-[10px]">#{e.attemptNo}</span>
                  <span className={e.passed ? "text-emerald-700" : "text-red-700"}>
                    %{Math.round(e.score)} · {e.passed ? "Geçti" : "Kaldı"}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
      <ExamForm assignmentId={a.id} questions={picked} />
    </Shell>
  );
}
