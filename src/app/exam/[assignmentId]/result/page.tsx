import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function ExamResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams?: Promise<{ attempt?: string; retake?: string }>;
}) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const sp = (await searchParams) || {};
  const attemptNo = sp.attempt ? Number(sp.attempt) : undefined;

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: {
        include: {
          course: {
            include: {
              exam: true,
              questionBank: {
                include: { questions: { include: { options: true } } },
              },
            },
          },
        },
      },
      examAttempts: { orderBy: { attemptNo: "desc" } },
      certificate: true,
    },
  });
  if (!a || a.userId !== user.id) notFound();

  const attempt = attemptNo
    ? a.examAttempts.find((x) => x.attemptNo === attemptNo)
    : a.examAttempts[0];
  if (!attempt) notFound();

  const answersMap = (attempt.answers as Record<string, string[]>) || {};
  const askedIds = Object.keys(answersMap);
  const bankQuestions = a.plan.course.questionBank?.questions || [];
  const askedQuestions = askedIds
    .map((id) => bankQuestions.find((q) => q.id === id))
    .filter(Boolean) as typeof bankQuestions;

  const passingScore = a.plan.course.exam?.passingScore ?? 70;
  const wrongCount = askedQuestions.filter((q) => {
    const picked = new Set(answersMap[q.id] || []);
    const correctIds = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
    if (picked.size !== correctIds.size) return true;
    for (const id of correctIds) if (!picked.has(id)) return true;
    return false;
  }).length;
  const correctCount = askedQuestions.length - wrongCount;

  return (
    <Shell user={user} title={`${a.plan.course.title} — Sınav Sonucu`}>
      <div
        className={`card p-5 mb-5 border-l-4 ${
          attempt.passed
            ? "border-l-emerald-500 bg-emerald-50"
            : "border-l-red-500 bg-red-50"
        }`}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div
              className={`text-2xl font-bold ${
                attempt.passed ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {attempt.passed ? "Başarılı" : "Başarısız"}
            </div>
            <div className="text-sm text-slate-700 mt-1">
              Puanınız: <strong>%{Math.round(attempt.score)}</strong> · Geçme notu: %
              {passingScore}
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Deneme #{attempt.attemptNo} · Doğru: {correctCount} / {askedQuestions.length}
              {" "}· Yanlış: {wrongCount}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {attempt.passed && a.certificate && (
              <a
                href={`/api/certificate/${a.certificate.id}`}
                className="btn-primary"
              >
                Sertifikayı İndir (PDF)
              </a>
            )}
            {!attempt.passed && sp.retake === "1" && (
              <Link href={`/course/${a.id}`} className="btn-primary">
                Eğitimi Tekrarla
              </Link>
            )}
            {!attempt.passed && sp.retake !== "1" && (
              <Link href={`/exam/${a.id}`} className="btn-primary">
                Tekrar Dene
              </Link>
            )}
            <Link href="/dashboard" className="btn-secondary">
              Gösterge Paneli
            </Link>
          </div>
        </div>
        {!attempt.passed && sp.retake === "1" && (
          <p className="text-sm text-red-800 mt-3">
            İki deneme hakkınızı da kullandınız. Eğitim içeriğini baştan
            tamamlayıp sınava yeniden girmeniz gerekiyor.
          </p>
        )}
      </div>

      <h2 className="font-semibold text-slate-900 mb-2">Soru Karnesi</h2>
      <div className="space-y-3">
        {askedQuestions.map((q, i) => {
          const picked = new Set(answersMap[q.id] || []);
          const correctIds = new Set(
            q.options.filter((o) => o.isCorrect).map((o) => o.id)
          );
          const isWrong =
            picked.size !== correctIds.size ||
            [...correctIds].some((id) => !picked.has(id));
          return (
            <div
              key={q.id}
              className={`card p-4 border-l-4 ${
                isWrong ? "border-l-red-400" : "border-l-emerald-400"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="font-medium text-slate-900">
                  {i + 1}. {q.text}
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    isWrong
                      ? "bg-red-100 text-red-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {isWrong ? "Yanlış" : "Doğru"}
                </span>
              </div>
              <ul className="space-y-1 text-sm">
                {q.options.map((o) => {
                  const isPicked = picked.has(o.id);
                  const isCorrect = o.isCorrect;
                  let cls = "text-slate-600";
                  let marker = "○";
                  if (isCorrect) {
                    cls = "text-emerald-700 font-medium";
                    marker = "✓";
                  }
                  if (isPicked && !isCorrect) {
                    cls = "text-red-700 font-medium line-through";
                    marker = "✗";
                  }
                  return (
                    <li key={o.id} className={`flex items-center gap-2 ${cls}`}>
                      <span className="w-4 text-center">{marker}</span>
                      <span>{o.text}</span>
                      {isPicked && (
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          sizin cevabınız
                        </span>
                      )}
                      {isCorrect && !isPicked && (
                        <span className="text-[10px] uppercase tracking-wide text-emerald-600">
                          doğru cevap
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
