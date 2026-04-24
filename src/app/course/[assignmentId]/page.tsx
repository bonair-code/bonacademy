import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { ScormPlayer } from "./ScormPlayer";
import { notFound } from "next/navigation";
import { getFile } from "@/lib/scorm/storage";
import { AttemptsHistoryDrawer } from "@/components/AttemptsHistoryDrawer";
import { buildTrainingSteps } from "@/lib/trainingSteps";
import { computeScormProgress } from "@/lib/scorm/progress";
import { getTranslations } from "next-intl/server";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams?: Promise<{ needsCompletion?: string }>;
}) {
  const user = await requireUser();
  const t = await getTranslations("coursePlayer");
  const { assignmentId } = await params;
  const sp = (await searchParams) || {};
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: {
        include: {
          course: {
            include: {
              exam: { select: { id: true } },
              questionBank: {
                select: { _count: { select: { questions: true } } },
              },
            },
          },
        },
      },
      attempts: { orderBy: { startedAt: "desc" } },
      examAttempts: { orderBy: { createdAt: "desc" } },
      certificate: { select: { id: true } },
    },
  });
  if (!a || a.userId !== user.id) notFound();
  const course = a.plan.course;
  if (!course.scormPackagePath || !course.scormEntryPoint) {
    return (
      <Shell user={user}>
        <p className="text-slate-500">{t("noPackage")}</p>
      </Shell>
    );
  }

  // Verify the entry file actually exists in the configured storage backend.
  // If the package was uploaded before we moved to Vercel Blob, the ephemeral
  // serverless filesystem copy is gone and we'd show a blank iframe otherwise.
  const entryCheck = await getFile(`${course.scormPackagePath}/${course.scormEntryPoint}`);
  if (!entryCheck) {
    return (
      <Shell user={user} title={course.title}>
        <div className="card p-6 max-w-2xl">
          <h2 className="font-semibold text-slate-900 mb-2">{t("packageMissingTitle")}</h2>
          <p className="text-sm text-slate-600 mb-3">
            {t("packageMissingBody")}
          </p>
          <p
            className="text-sm text-slate-600"
            dangerouslySetInnerHTML={{ __html: t.raw("packageMissingAdmin") as string }}
          />
        </div>
      </Shell>
    );
  }

  const contentUrl = `/api/scorm-content/${course.scormPackagePath}/${course.scormEntryPoint}`;
  const scormAttempts = a.attempts.filter((x) => x.type === "SCORM");
  const retakeRequired = a.status === "RETAKE_REQUIRED";

  if (a.status === "PENDING") {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  } else if (a.status === "RETAKE_REQUIRED") {
    // Forced retake: kapanmamış eski SCORM denemelerini finalize et ve
    // temiz bir yeni deneme başlat. Aksi halde 'latest' eski tamamlanmış
    // cmiData'yı taşır ve scorm-again içeriği "zaten bitti" diye geri
    // yükler — bu yüzden tekrar alanlar eğitimi baştan görmüyor.
    await prisma.attempt.updateMany({
      where: { assignmentId: a.id, type: "SCORM", finishedAt: null },
      data: { finishedAt: new Date() },
    });
    await prisma.attempt.create({
      data: { assignmentId: a.id, type: "SCORM", cmiData: {} as any },
    });
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "IN_PROGRESS" },
    });
  }

  // Sadece henüz bitmemiş (finishedAt == null) en son SCORM denemesinin
  // CMI verisini geri yükle. Bitirilmiş denemelerin cmiData'sı resume için
  // kullanılmamalı — zaten kapanmış bir oturum.
  const resumeAttempt = retakeRequired
    ? undefined
    : scormAttempts.find((x) => x.finishedAt == null);
  const initialCmi =
    (resumeAttempt?.cmiData as Record<string, unknown> | null) ?? undefined;

  // İlerleme yüzdesi: en son SCORM denemesinin CMI verisinden hesapla.
  // RETAKE'de yeni boş deneme oluşturduğumuz için 0'dan başlar.
  const latestCmi =
    (scormAttempts[0]?.cmiData as Record<string, unknown> | null) ?? null;
  const progress = computeScormProgress(latestCmi, a.status);
  const examAttempts = a.examAttempts; // already desc

  const stampedRev = a.revisionNumber;
  const liveRev = course.currentRevision;
  const showOutdatedNotice =
    stampedRev != null && stampedRev < liveRev && a.status !== "COMPLETED";

  // RETAKE_REQUIRED explicitly forces the learner to redo the SCORM — we do
  // NOT treat that as "done" and we do NOT surface the jump-to-exam shortcut.
  const scormDone =
    a.status === "SCORM_COMPLETED" || a.status === "EXAM_FAILED";

  const hasExam =
    !!course.exam || (course.questionBank?._count.questions ?? 0) > 0;
  const steps = buildTrainingSteps({
    assignmentId: a.id,
    // Status kaydı DB'ye az önce IN_PROGRESS olarak güncellenmiş olabilir;
    // ama a.status hâlâ eski değeri taşıyor. UI için en doğru resim: eğer
    // yukarıdaki update çalıştıysa IN_PROGRESS, yoksa mevcut status.
    status:
      a.status === "PENDING" || a.status === "RETAKE_REQUIRED"
        ? "IN_PROGRESS"
        : a.status,
    hasExam,
    hasCertificate: !!a.certificate,
    certificateId: a.certificate?.id ?? null,
    context: "course",
  });

  return (
    <Shell user={user} trainingSteps={steps} trainingTitle={course.title}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-lg font-semibold">{course.title}</h1>
        <div className="flex items-center gap-2 text-xs">
          {stampedRev != null && (
            <span className="badge-teal">{t("assignmentVersion", { rev: stampedRev })}</span>
          )}
          <span className="text-slate-500">{t("currentVersion", { rev: liveRev })}</span>
        </div>
      </div>
      {showOutdatedNotice && (
        <div className="card p-3 mb-3 text-sm text-amber-800 bg-amber-50 border-amber-200">
          {t("outdatedNotice", { rev: liveRev })}
        </div>
      )}
      {sp.needsCompletion === "1" && !scormDone && (
        <div className="card p-3 mb-3 text-sm text-amber-900 bg-amber-50 border-amber-200">
          {t("needsCompletion")}
        </div>
      )}
      {retakeRequired && (
        <div className="card p-3 mb-3 text-sm text-red-800 bg-red-50 border-red-200">
          {t("retakeRequired")}
        </div>
      )}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
          <span>{t("progressLabel", { label: progress.label })}</span>
          <span className="font-medium">{t("progressPercent", { pct: progress.percent })}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              progress.percent >= 100 ? "bg-emerald-500" : "bg-teal-500"
            }`}
            style={{ width: `${progress.percent}%` }}
            aria-label={t("progressAria", { pct: progress.percent })}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {t("progressHint")}
        </p>
      </div>
      <ScormPlayer
        assignmentId={a.id}
        contentUrl={contentUrl}
        version={course.scormVersion}
        initialCmi={initialCmi}
      />
      {/* "Sınava Başla" düğmesi eğitim altında daima görünür; yalnızca SCORM
          tamamlanmadıysa devre dışı — kullanıcı adımın varlığından haberdar
          olsun ama önce eğitimi bitirmesi gerektiğini net görsün. */}
      {hasExam && (
        <div className="mt-4 flex items-center justify-end gap-3">
          {!scormDone && (
            <span className="text-xs text-slate-500">
              {t("examHint")}
            </span>
          )}
          {scormDone ? (
            <a href={`/exam/${a.id}`} className="btn-primary">
              {t("startExam")}
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={t("completeFirstTitle")}
              className="btn-primary opacity-50 cursor-not-allowed"
            >
              {t("startExam")}
            </button>
          )}
        </div>
      )}
      {(scormAttempts.length > 0 || examAttempts.length > 0) && (
        <div className="mt-6">
          <AttemptsHistoryDrawer
            scormAttempts={scormAttempts.map((at) => ({
              id: at.id,
              startedAt: at.startedAt.toISOString(),
              finishedAt: at.finishedAt ? at.finishedAt.toISOString() : null,
            }))}
            examAttempts={examAttempts.map((e) => ({
              id: e.id,
              attemptNo: e.attemptNo,
              score: e.score,
              passed: e.passed,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
        </div>
      )}
    </Shell>
  );
}
