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
 * Sınav başlangıcında (GET /exam/[assignmentId]) o anki attemptNo için aktif
 * bir ExamSession var mı bak; yoksa rastgele soru kümesini seçip snapshot'la.
 *
 * Bu fonksiyon idempotenttir: aynı attemptNo için tekrar çağrılırsa mevcut
 * questionIds'ı döndürür — yani kullanıcı sayfayı yenilerse aynı soru
 * setini görür. Farklı soru seti için yeni attemptNo (yeni ExamAttempt)
 * gerekir.
 */
export async function ensureExamSession(opts: {
  assignmentId: string;
  attemptNo: number; // 1 tabanlı; examAttempts.length + 1
  bankQuestionIds: string[];
  questionCount: number;
  shuffle: boolean;
}): Promise<{ id: string; questionIds: string[] }> {
  const existing = await prisma.examSession.findUnique({
    where: {
      assignmentId_attemptNo: {
        assignmentId: opts.assignmentId,
        attemptNo: opts.attemptNo,
      },
    },
  });
  if (existing && !existing.submittedAt) {
    return { id: existing.id, questionIds: existing.questionIds };
  }
  // Yeni sorular seç. questionCount bankadan büyükse hepsini kullan.
  const picked = pickQuestions(
    opts.bankQuestionIds,
    Math.min(opts.questionCount, opts.bankQuestionIds.length),
    opts.shuffle
  );
  // submittedAt dolu olan eski kayıt varsa üzerine yazma — başka attemptNo'dur.
  // attemptNo zaten bu deneme için benzersiz olduğundan create çalışır.
  const created = await prisma.examSession.create({
    data: {
      assignmentId: opts.assignmentId,
      attemptNo: opts.attemptNo,
      questionIds: picked,
    },
  });
  return { id: created.id, questionIds: created.questionIds };
}

/**
 * After submitting an exam, decide assignment outcome:
 * - Passed → EXAM_PASSED → issue cert elsewhere
 * - Failed: if attemptNo >= MAX → RETAKE_REQUIRED (user must redo SCORM)
 * - Failed otherwise → EXAM_FAILED (can retry exam)
 *
 * Güvenlik notu: Puanlama istemciden gelen `answers` yapısına değil, server'da
 * saklanan ExamSession.questionIds snapshot'ına göre yapılır. Gönderilmeyen
 * sorular `scoreExam`'de 0 puan alır (picked.size === 0 ≠ correctIds.size).
 */
export async function submitExam(opts: {
  assignmentId: string;
  sessionId?: string;
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

  const attemptNo = a.examAttempts.length + 1;

  // Bu attempt için aktif session'ı bul. sessionId verildiyse onunla teyit et.
  const session = await prisma.examSession.findUnique({
    where: {
      assignmentId_attemptNo: {
        assignmentId: a.id,
        attemptNo,
      },
    },
  });
  if (!session) {
    throw new Error(
      "Sınav oturumu bulunamadı — sayfayı yenileyip sınavı tekrar başlatın."
    );
  }
  if (opts.sessionId && opts.sessionId !== session.id) {
    throw new Error("Sınav oturumu uyuşmuyor.");
  }
  if (session.submittedAt) {
    throw new Error("Bu sınav zaten gönderilmiş.");
  }

  // `asked` SERVER snapshot'ından geliyor — istemciye güvenmiyoruz.
  const askedSet = new Set(session.questionIds);
  const asked = bank.questions.filter((q) => askedSet.has(q.id));

  // Gelen cevapları sanitize et: yalnızca bu sınavda sorulan sorulara ait
  // cevaplar, ve yalnızca o soruya ait gerçek option ID'leri saklanır.
  // Sorulmayan sorulara gelen cevaplar yok sayılır.
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

  // Session'ı kilitle ve ExamAttempt'i aynı transaction'da oluştur — double
  // submit yarışına karşı güvence: submittedAt NULL koşullu updateMany + attempt
  // yaratma. İlk kazanan yazdığı için ikinci submit "zaten gönderilmiş" hatası
  // alır.
  try {
    await prisma.$transaction(async (tx) => {
      const lock = await tx.examSession.updateMany({
        where: { id: session.id, submittedAt: null },
        data: { submittedAt: new Date() },
      });
      if (lock.count === 0) {
        throw new Error("Bu sınav zaten gönderilmiş.");
      }
      await tx.examAttempt.create({
        data: {
          assignmentId: a.id,
          attemptNo,
          score,
          passed,
          answers: sanitized,
        },
      });
    });
  } catch (err) {
    // attemptNo @@unique ihlali de burada yakalanır.
    throw err;
  }

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
