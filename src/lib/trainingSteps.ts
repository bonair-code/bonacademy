import type { TrainingStep } from "@/components/Shell";

export type TrainingStepContext = "course" | "exam" | "result";

/**
 * Bir atama için soldaki ilerleme adımlarını üret.
 * States:
 *   - done    : tamam (yeşil check)
 *   - current : şu an bu sayfadayız (teal dolgu)
 *   - ready   : açıldı, tıklanabilir (beyaz + teal kenarlık)
 *   - locked  : henüz açılmadı (gri kilit)
 */
export function buildTrainingSteps(opts: {
  assignmentId: string;
  status: string;
  hasExam: boolean;
  hasCertificate: boolean;
  certificateId?: string | null;
  context: TrainingStepContext;
}): TrainingStep[] {
  const { assignmentId, status, hasExam, hasCertificate, certificateId, context } = opts;

  const scormDone =
    status === "SCORM_COMPLETED" ||
    status === "EXAM_PASSED" ||
    status === "EXAM_FAILED" ||
    status === "COMPLETED";
  const examPassed = status === "EXAM_PASSED" || status === "COMPLETED";

  const steps: TrainingStep[] = [];

  // 1) Eğitim içeriği (SCORM)
  steps.push({
    label: "Eğitim İçeriği",
    sub: scormDone
      ? "Tamamlandı"
      : status === "RETAKE_REQUIRED"
      ? "Baştan tekrar"
      : context === "course"
      ? "Devam ediyor"
      : "Başlamadı",
    state:
      context === "course"
        ? "current"
        : scormDone
        ? "done"
        : "ready",
    href: `/course/${assignmentId}`,
  });

  // 2) Sınav
  if (hasExam) {
    const examState: TrainingStep["state"] =
      context === "exam" || context === "result"
        ? "current"
        : examPassed
        ? "done"
        : scormDone
        ? "ready"
        : "locked";
    steps.push({
      label: "Sınav",
      sub: examPassed
        ? "Geçildi"
        : status === "EXAM_FAILED"
        ? "Yeniden dene"
        : status === "RETAKE_REQUIRED"
        ? "Eğitim sonrası"
        : scormDone
        ? "Hazır"
        : "Eğitim tamamlanınca açılır",
      state: examState,
      href: examState === "locked" ? undefined : `/exam/${assignmentId}`,
    });
  }

  // 3) Sertifika
  if (hasExam || hasCertificate) {
    steps.push({
      label: "Sertifika",
      sub: hasCertificate
        ? "Hazır"
        : examPassed
        ? "Üretiliyor"
        : "Sınav sonrası",
      state: hasCertificate
        ? "done"
        : examPassed
        ? "ready"
        : "locked",
      href:
        hasCertificate && certificateId
          ? `/api/certificate/${certificateId}`
          : undefined,
    });
  }

  return steps;
}
