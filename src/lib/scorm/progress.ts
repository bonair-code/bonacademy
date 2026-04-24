// SCORM CMI verisinden kullanıcıya gösterilecek tek bir ilerleme yüzdesi üret.
// Öncelik sırası:
//   1) cmi.progress_measure (SCORM 2004, 0..1) — en doğru sinyal
//   2) completion_status / lesson_status — completed/passed=100, incomplete=50, browsed=25
//   3) Hiç veri yoksa 0
// Statü zaten SCORM_COMPLETED veya sonrasıysa 100 döner (CMI eski olabilir).

type CmiLike = Record<string, unknown> | null | undefined;

const TERMINAL_STATUSES = new Set([
  "SCORM_COMPLETED",
  "EXAM_PASSED",
  "EXAM_FAILED",
  "COMPLETED",
]);

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function computeScormProgress(
  cmi: CmiLike,
  assignmentStatus?: string
): { percent: number; label: string } {
  if (assignmentStatus && TERMINAL_STATUSES.has(assignmentStatus)) {
    return { percent: 100, label: "Tamamlandı" };
  }

  // SCORM 2004 progress_measure (0..1)
  const pm = getPath(cmi, "progress_measure") ?? getPath(cmi, "cmi.progress_measure");
  const pmNum = typeof pm === "string" ? parseFloat(pm) : typeof pm === "number" ? pm : NaN;
  if (Number.isFinite(pmNum) && pmNum >= 0) {
    const pct = Math.max(0, Math.min(100, Math.round(pmNum * 100)));
    return { percent: pct, label: pct === 100 ? "Tamamlandı" : "Devam ediyor" };
  }

  const status =
    (getPath(cmi, "completion_status") as string | undefined) ||
    (getPath(cmi, "cmi.completion_status") as string | undefined) ||
    (getPath(cmi, "core.lesson_status") as string | undefined) ||
    (getPath(cmi, "cmi.core.lesson_status") as string | undefined) ||
    (getPath(cmi, "lesson_status") as string | undefined);

  switch (status) {
    case "completed":
    case "passed":
      return { percent: 100, label: "Tamamlandı" };
    case "incomplete":
      return { percent: 50, label: "Devam ediyor" };
    case "browsed":
      return { percent: 25, label: "Devam ediyor" };
    case "not attempted":
    case "unknown":
    case undefined:
    case "":
      return { percent: 0, label: "Başlamadı" };
    default:
      return { percent: 0, label: "Başlamadı" };
  }
}
