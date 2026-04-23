import { prisma } from "@/lib/db";
import type { Question, AnswerOption } from "@prisma/client";

export const MAX_EXAM_ATTEMPTS_BEFORE_RETAKE = 2;

/** Picks `count` random questions from the bank. */
export function pickQuestions<T>(all: T[], count: number, shuffle = true): T[] {
  if (!shuffle) return all.slice(0, count);
  const copy = [...all];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/** Score: sum(points for correctly & fully answered) / totalPoints * 100 */
export function scoreExam(
  questions: (Question & { options: AnswerOption[] })[],
  submitted: Record<string, string[]>
): { score: number; total: number; correctCount: number } {
  const total = questions.reduce((s, q) => s + q.points, 0) || 1;
  let earned = 0;
  let correctCount = 0;
  for (const q of questions) {
    const correctIds = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
    const picked = new Set(submitted[q.id] ?? []);
    if (correctIds.size === picked.size && [...correctIds].every((id) => picked.has(id))) {
      earned += q.points;
      correctCount++;
    }
  }
  return { score: (earned / total) * 100, total: questions.length, correctCount };
}

/**
 * After submitting an exam, decide assignment outcome:
 * - Passed → EXAM_PASSED → issue cert elsewhere
 * - Failed: if attemptNo >= MAX → RETAKE_REQUIRED (user must redo SCORM)
 * - Failed otherwise → EXAM_FAILED (can retry exam)
 */
export async function submitExam(opts: {
  assignmentId: string;
  answers: Record<string, string[]>;
}) {
  const a = await prisma.assignment.findUnique({
    where: { id: opts.assignmentId },
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
  if (!a) throw new Error("Assignment yok");
  const exam = a.plan.course.exam;
  const bank = a.plan.course.questionBank;
  if (!exam || !bank) throw new Error("Sınav tanımlı değil");

  const asked = bank.questions.filter((q) => opts.answers[q.id] !== undefined);
  // Gelen cevapları sanitize et: yalnızca bu sınavda sorulan sorulara ait
  // cevaplar, ve yalnızca o soruya ait gerçek option ID'leri saklanır.
  // Böylece uydurma/fazla anahtarlar DB'ye sızamaz.
  const sanitized: Record<string, string[]> = {};
  for (const q of asked) {
    const validOptionIds = new Set(q.options.map((o) => o.id));
    const submitted = opts.answers[q.id];
    const picked = Array.isArray(submitted)
      ? submitted.filter((id) => typeof id === "string" && validOptionIds.has(id))
      : [];
    sanitized[q.id] = [...new Set(picked)];
  }
  const { score } = scoreExam(asked, sanitized);
  const passed = score >= exam.passingScore;
  const attemptNo = a.examAttempts.length + 1;

  await prisma.examAttempt.create({
    data: {
      assignmentId: a.id,
      attemptNo,
      score,
      passed,
      answers: sanitized,
    },
  });

  let newStatus: typeof a.status;
  if (passed) newStatus = "EXAM_PASSED";
  else if (attemptNo >= MAX_EXAM_ATTEMPTS_BEFORE_RETAKE) newStatus = "RETAKE_REQUIRED";
  else newStatus = "EXAM_FAILED";

  await prisma.assignment.update({
    where: { id: a.id },
    data: { status: newStatus, completedAt: passed ? new Date() : null },
  });

  return { passed, score, attemptNo, status: newStatus };
}
