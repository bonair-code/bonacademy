import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { UploadScormForm } from "./UploadScormForm";
import { BulkQuestionImport } from "./BulkQuestionImport";
import { createCourseRevision, ensureBaselineRevision } from "@/lib/courseRevisions";
import { audit } from "@/lib/audit";
import { getTranslations } from "next-intl/server";

async function addQuestion(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
  const courseId = String(formData.get("courseId"));
  const text = String(formData.get("text") || "").trim();
  // Tek doğru cevap seçimi: radio "correct" değeri hangi indeks doğruysa onu verir.
  const correctIdx = Number(formData.get("correct"));
  const opts = [0, 1, 2, 3]
    .map((i) => ({
      text: String(formData.get(`opt_${i}`) || "").trim(),
      isCorrect: i === correctIdx,
    }))
    .filter((o) => o.text);
  if (!text || opts.length < 2) return;
  if (!opts.some((o) => o.isCorrect)) return; // doğru şık seçilmeli
  const bank = await prisma.questionBank.upsert({
    where: { courseId },
    update: {},
    create: { courseId },
  });
  // Exam kaydı hiç oluşturulmamışsa varsayılanlarla üret — böylece admin
  // sadece soru ekleyip çıkarsa bile sınav ayağa kalkıyor; "Bu kurs için
  // sınav tanımlı değil" mesajını tetiklemiyor.
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { passingScore: true },
  });
  await prisma.exam.upsert({
    where: { courseId },
    update: {},
    create: {
      courseId,
      questionCount: 10,
      passingScore: course?.passingScore ?? 70,
    },
  });
  await prisma.question.create({
    data: { bankId: bank.id, text, options: { create: opts } },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

async function deleteQuestion(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
  const id = String(formData.get("id"));
  const courseId = String(formData.get("courseId"));
  await prisma.question.delete({ where: { id } });
  revalidatePath(`/admin/courses/${courseId}`);
}

async function saveCourseMeta(formData: FormData) {
  "use server";
  const t = await getTranslations("adminCourses");
  const admin = await requireRole("ADMIN", "MANAGER");
  const courseId = String(formData.get("courseId"));
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const passingScore = Number(formData.get("passingScore") || 70);
  const questionCount = Number(formData.get("questionCount") || 10);
  const changeNote = String(formData.get("changeNote") || "").trim() || undefined;
  const ownerManagerId = String(formData.get("ownerManagerId") || "").trim();
  if (!title) return;
  if (!ownerManagerId) {
    throw new Error(t("errors.ownerRequired"));
  }
  const owner = await prisma.user.findUnique({
    where: { id: ownerManagerId },
    select: { id: true, role: true, isActive: true },
  });
  if (!owner || owner.role !== "MANAGER" || !owner.isActive) {
    throw new Error(t("errors.ownerInvalid"));
  }

  const existing = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });

  // Başlık başka bir kursla çakışmasın (büyük/küçük harf duyarsız).
  if (existing.title.toLowerCase() !== title.toLowerCase()) {
    const duplicate = await prisma.course.findFirst({
      where: {
        id: { not: courseId },
        title: { equals: title, mode: "insensitive" },
      },
      select: { title: true },
    });
    if (duplicate) {
      throw new Error(t("errors.duplicateTitle", { title: duplicate.title }));
    }
  }

  const metaChanged =
    existing.title !== title ||
    (existing.description ?? "") !== description ||
    existing.passingScore !== passingScore ||
    existing.ownerManagerId !== ownerManagerId;

  if (metaChanged) {
    await ensureBaselineRevision(existing, admin.id);
  }

  await prisma.course.update({
    where: { id: courseId },
    data: { title, description: description || null, passingScore, ownerManagerId },
  });

  // Sınav ayarı da aynı formda: kurs kaydı yoksa varsayılanla oluştur, varsa güncelle.
  await prisma.questionBank.upsert({
    where: { courseId },
    update: {},
    create: { courseId },
  });
  await prisma.exam.upsert({
    where: { courseId },
    update: { questionCount, passingScore },
    create: { courseId, questionCount, passingScore },
  });

  if (metaChanged) {
    await createCourseRevision(
      courseId,
      admin.id,
      changeNote ?? t("detail.courseInfoUpdated")
    );
    await audit({
      actorId: admin.id,
      action:
        existing.ownerManagerId !== ownerManagerId
          ? "course.owner.change"
          : "course.update",
      entity: "Course",
      entityId: courseId,
      metadata: {
        titleBefore: existing.title,
        titleAfter: title,
        passingScoreBefore: existing.passingScore,
        passingScoreAfter: passingScore,
        ownerManagerIdBefore: existing.ownerManagerId,
        ownerManagerIdAfter: ownerManagerId,
      },
    });
  }

  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  revalidatePath("/courses");
}

async function createManualRevision(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN", "MANAGER");
  const courseId = String(formData.get("courseId"));
  const changeNote = String(formData.get("changeNote") || "").trim();
  if (!changeNote) return;
  const existing = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  await ensureBaselineRevision(existing, admin.id);
  await createCourseRevision(courseId, admin.id, changeNote);
  revalidatePath(`/admin/courses/${courseId}`);
}

export default async function CourseDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("ADMIN", "MANAGER");
  const t = await getTranslations("adminCourses");
  const { id } = await params;
  const [course, managers] = await Promise.all([
    prisma.course.findUnique({
      where: { id },
      include: {
        exam: true,
        questionBank: { include: { questions: { include: { options: true } } } },
        ownerManager: { select: { id: true, name: true, email: true } },
        revisions: {
          orderBy: { revisionNumber: "desc" },
          include: { createdBy: { select: { name: true, email: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "MANAGER", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!course) notFound();
  // Pasifleştirilmiş mevcut sorumluyu dropdown'a elle ekle ki kurs düzenlenirken
  // boşa düşmesin — admin yeni bir aktif yönetici seçene kadar mevcut değer korunur.
  const managerOptions =
    course.ownerManager && !managers.some((m) => m.id === course.ownerManager!.id)
      ? [course.ownerManager, ...managers]
      : managers;

  return (
    <Shell
      user={user}
      title={course.title}
      subtitle={t("detail.currentVersion", { version: course.currentRevision })}
    >
      <div className="mb-4">
        <a
          href={`/admin/audit?entity=Course&entityId=${course.id}`}
          className="text-xs text-sky-700 hover:underline"
        >
          {t("detail.auditLink")} →
        </a>
      </div>
      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-3">{t("detail.infoAndExam")}</h2>
        <form action={saveCourseMeta} className="space-y-3">
          <input type="hidden" name="courseId" value={course.id} />
          <label className="text-sm block">
            {t("title")}
            <input
              name="title"
              defaultValue={course.title}
              required
              maxLength={255}
              className="input mt-1 w-full"
            />
          </label>
          <label className="text-sm block">
            {t("ownerManager")} <span className="text-red-600">*</span>
            <select
              name="ownerManagerId"
              required
              defaultValue={course.ownerManagerId ?? ""}
              className="input mt-1 w-full"
            >
              <option value="" disabled>
                {managerOptions.length === 0
                  ? t("defineManagerFirst")
                  : t("selectManager")}
              </option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            {t("detail.description")}
            <textarea
              name="description"
              defaultValue={course.description ?? ""}
              rows={2}
              maxLength={2000}
              className="input mt-1 w-full"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              {t("detail.passingScore")}
              <input
                name="passingScore"
                type="number"
                defaultValue={course.exam?.passingScore ?? course.passingScore}
                min={0}
                max={100}
                className="input mt-1 w-full"
              />
            </label>
            <label className="text-sm">
              {t("detail.questionCount")}
              <input
                name="questionCount"
                type="number"
                defaultValue={course.exam?.questionCount ?? 10}
                min={1}
                className="input mt-1 w-full"
              />
            </label>
          </div>
          <label className="text-sm block">
            {t("detail.revisionNote")}
            <input
              name="changeNote"
              placeholder={t("detail.revisionNotePlaceholder")}
              maxLength={1000}
              className="input mt-1 w-full"
            />
          </label>
          <button className="btn-primary">{t("detail.save")}</button>
        </form>
      </section>

      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">{t("detail.scormPackage")}</h2>
        <p className="text-xs text-slate-500 mb-2">
          {t("detail.current")}:{" "}
          {course.scormPackagePath
            ? `${course.scormPackagePath} · ${course.scormVersion}`
            : t("detail.none")}
        </p>
        <UploadScormForm courseId={course.id} />
      </section>

      {/* Revision History */}
      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">{t("detail.revisionHistory")}</h2>
        <p className="text-xs text-slate-500 mb-3">
          {t("detail.revisionHelp")}
        </p>
        <form action={createManualRevision} className="flex gap-2 mb-4">
          <input type="hidden" name="courseId" value={course.id} />
          <input
            name="changeNote"
            placeholder={t("detail.manualRevisionPlaceholder")}
            required
            maxLength={1000}
            className="input flex-1"
          />
          <button className="btn-secondary text-sm">{t("detail.createRevision")}</button>
        </form>
        <div className="border rounded-lg divide-y text-sm">
          {course.revisions.length === 0 && (
            <p className="p-4 text-slate-500">{t("detail.noRevisions")}</p>
          )}
          {course.revisions.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="badge-teal">v{r.revisionNumber}</span>
                  {r.revisionNumber === course.currentRevision && (
                    <span className="text-[11px] text-teal-700 font-medium">{t("detail.currentBadge")}</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500">
                  {r.createdAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {r.createdBy.name}
                </span>
              </div>
              {r.changeNote && (
                <p className="text-slate-700 mt-1">{r.changeNote}</p>
              )}
              <div className="text-[11px] text-slate-500 mt-1">
                {r.title} · {t("detail.passingLabel", { score: r.passingScore })}
                {r.scormPackagePath ? ` · ${t("detail.scormLabel", { path: r.scormPackagePath })}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-2">
          {t("detail.questionBank", { count: course.questionBank?.questions.length ?? 0 })}
        </h2>
        <div className="mb-4">
          <BulkQuestionImport courseId={course.id} />
        </div>
        <form action={addQuestion} className="space-y-3 mb-6 border border-slate-200 rounded-lg p-3 bg-slate-50">
          <input type="hidden" name="courseId" value={course.id} />
          <textarea
            name="text"
            placeholder={t("detail.questionText")}
            className="input w-full"
            rows={2}
          />
          <p className="text-xs text-slate-600">
            {t("detail.singleCorrectHelpBefore")}
            <strong>{t("detail.singleCorrectHelpStrong")}</strong>
            {t("detail.singleCorrectHelpAfter")}
          </p>
          {[0, 1, 2, 3].map((i) => (
            <label
              key={i}
              className="flex items-center gap-3 text-sm bg-white border border-slate-200 rounded-md px-3 py-2"
            >
              <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-emerald-700">
                <input
                  name="correct"
                  value={i}
                  type="radio"
                  className="h-4 w-4 accent-emerald-600"
                />
                {t("detail.correct")}
              </span>
              <input
                name={`opt_${i}`}
                placeholder={t("detail.optionPlaceholder", { n: i + 1 })}
                className="input flex-1"
              />
            </label>
          ))}
          <button className="btn-primary">{t("detail.addQuestion")}</button>
        </form>
        <div className="space-y-2">
          {course.questionBank?.questions.length === 0 && (
            <p className="text-sm text-slate-500">{t("detail.noQuestions")}</p>
          )}
          {course.questionBank?.questions.map((q, qi) => (
            <div key={q.id} className="border border-slate-200 rounded-md p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium text-slate-900">
                  {qi + 1}. {q.text}
                </div>
                <form action={deleteQuestion}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="courseId" value={course.id} />
                  <button className="text-xs text-red-600 hover:underline">{t("detail.delete")}</button>
                </form>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {q.options.map((o) => (
                  <li
                    key={o.id}
                    className={`flex items-center gap-2 ${
                      o.isCorrect ? "text-emerald-700 font-medium" : "text-slate-600"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full border ${
                        o.isCorrect
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-slate-300"
                      }`}
                    />
                    {o.text}
                    {o.isCorrect && (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700">
                        {t("detail.correctLabel")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </Shell>
  );
}
