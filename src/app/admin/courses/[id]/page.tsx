import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { UploadScormForm } from "./UploadScormForm";
import { BulkQuestionImport } from "./BulkQuestionImport";
import { createCourseRevision, ensureBaselineRevision } from "@/lib/courseRevisions";

async function saveExam(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const courseId = String(formData.get("courseId"));
  const questionCount = Number(formData.get("questionCount") || 10);
  const passingScore = Number(formData.get("passingScore") || 70);
  await prisma.exam.upsert({
    where: { courseId },
    update: { questionCount, passingScore },
    create: { courseId, questionCount, passingScore },
  });
  await prisma.questionBank.upsert({
    where: { courseId },
    update: {},
    create: { courseId },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

async function addQuestion(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const courseId = String(formData.get("courseId"));
  const text = String(formData.get("text") || "").trim();
  const opts = [0, 1, 2, 3]
    .map((i) => ({
      text: String(formData.get(`opt_${i}`) || "").trim(),
      isCorrect: formData.get(`correct_${i}`) === "on",
    }))
    .filter((o) => o.text);
  if (!text || opts.length < 2) return;
  const bank = await prisma.questionBank.upsert({
    where: { courseId },
    update: {},
    create: { courseId },
  });
  await prisma.question.create({
    data: { bankId: bank.id, text, options: { create: opts } },
  });
  revalidatePath(`/admin/courses/${courseId}`);
}

async function saveCourseMeta(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
  const courseId = String(formData.get("courseId"));
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const passingScore = Number(formData.get("passingScore") || 70);
  const changeNote = String(formData.get("changeNote") || "").trim() || undefined;
  if (!title) return;

  const existing = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  const changed =
    existing.title !== title ||
    (existing.description ?? "") !== description ||
    existing.passingScore !== passingScore;

  if (changed) {
    await ensureBaselineRevision(existing, admin.id);
  }

  await prisma.course.update({
    where: { id: courseId },
    data: { title, description: description || null, passingScore },
  });

  if (changed) {
    await createCourseRevision(
      courseId,
      admin.id,
      changeNote ?? "Kurs bilgileri güncellendi"
    );
  }

  revalidatePath(`/admin/courses/${courseId}`);
}

async function createManualRevision(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
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
  const user = await requireRole("ADMIN");
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      exam: true,
      questionBank: { include: { questions: { include: { options: true } } } },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: { createdBy: { select: { name: true, email: true } } },
      },
    },
  });
  if (!course) notFound();

  return (
    <Shell
      user={user}
      title={course.title}
      subtitle={`Mevcut sürüm: v${course.currentRevision}`}
    >
      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">Kurs Bilgileri</h2>
        <form action={saveCourseMeta} className="space-y-3">
          <input type="hidden" name="courseId" value={course.id} />
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-sm">
              Başlık
              <input
                name="title"
                defaultValue={course.title}
                required
                className="input mt-1"
              />
            </label>
            <label className="text-sm">
              Geçme Skoru (%)
              <input
                name="passingScore"
                type="number"
                defaultValue={course.passingScore}
                min={0}
                max={100}
                className="input mt-1"
              />
            </label>
          </div>
          <label className="text-sm block">
            Açıklama
            <textarea
              name="description"
              defaultValue={course.description ?? ""}
              rows={2}
              className="input mt-1 w-full"
            />
          </label>
          <label className="text-sm block">
            Revizyon Notu (değişiklik varsa oluşturulur) — isteğe bağlı
            <input
              name="changeNote"
              placeholder="örn. 'Başlık güncellendi'"
              className="input mt-1 w-full"
            />
          </label>
          <button className="btn-primary">Kaydet</button>
        </form>
      </section>

      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">SCORM Paketi</h2>
        <p className="text-xs text-slate-500 mb-2">
          Mevcut:{" "}
          {course.scormPackagePath
            ? `${course.scormPackagePath} · ${course.scormVersion}`
            : "Yok"}
        </p>
        <UploadScormForm courseId={course.id} />
      </section>

      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">Sınav Ayarları</h2>
        <form action={saveExam} className="flex gap-2 items-end">
          <input type="hidden" name="courseId" value={course.id} />
          <label className="text-sm">
            Soru sayısı
            <input
              name="questionCount"
              type="number"
              defaultValue={course.exam?.questionCount ?? 10}
              className="input block mt-1"
            />
          </label>
          <label className="text-sm">
            Geçme %
            <input
              name="passingScore"
              type="number"
              defaultValue={course.exam?.passingScore ?? 70}
              className="input block mt-1"
            />
          </label>
          <button className="btn-primary">Kaydet</button>
        </form>
      </section>

      {/* Revision History */}
      <section className="card p-4 mb-6">
        <h2 className="font-semibold mb-2">Revizyon Geçmişi</h2>
        <p className="text-xs text-slate-500 mb-3">
          Her SCORM yüklemesi ve kurs bilgisi değişikliği yeni bir revizyon oluşturur.
          Aşağıdan manuel bir revizyon kaydı da ekleyebilirsin (içerik değişmeden süreç notu için).
        </p>
        <form action={createManualRevision} className="flex gap-2 mb-4">
          <input type="hidden" name="courseId" value={course.id} />
          <input
            name="changeNote"
            placeholder="Manuel revizyon notu (zorunlu)"
            required
            className="input flex-1"
          />
          <button className="btn-secondary text-sm">Revizyon Oluştur</button>
        </form>
        <div className="border rounded-lg divide-y text-sm">
          {course.revisions.length === 0 && (
            <p className="p-4 text-slate-500">Henüz revizyon yok.</p>
          )}
          {course.revisions.map((r) => (
            <div key={r.id} className="p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="badge-teal">v{r.revisionNumber}</span>
                  {r.revisionNumber === course.currentRevision && (
                    <span className="text-[11px] text-teal-700 font-medium">mevcut</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500">
                  {r.createdAt.toLocaleString("tr-TR")} · {r.createdBy.name}
                </span>
              </div>
              {r.changeNote && (
                <p className="text-slate-700 mt-1">{r.changeNote}</p>
              )}
              <div className="text-[11px] text-slate-500 mt-1">
                {r.title} · geçme %{r.passingScore}
                {r.scormPackagePath ? ` · SCORM: ${r.scormPackagePath}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-2">
          Soru Bankası ({course.questionBank?.questions.length ?? 0})
        </h2>
        <div className="mb-4">
          <BulkQuestionImport courseId={course.id} />
        </div>
        <form action={addQuestion} className="space-y-2 mb-4">
          <input type="hidden" name="courseId" value={course.id} />
          <textarea
            name="text"
            placeholder="Soru metni"
            className="input w-full"
            rows={2}
          />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <input name={`correct_${i}`} type="checkbox" title="Doğru şık" />
              <input
                name={`opt_${i}`}
                placeholder={`Şık ${i + 1}`}
                className="input flex-1"
              />
            </div>
          ))}
          <button className="btn-primary">Soru Ekle</button>
        </form>
        <ul className="text-sm list-disc pl-5 space-y-1">
          {course.questionBank?.questions.map((q) => (
            <li key={q.id}>{q.text}</li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
