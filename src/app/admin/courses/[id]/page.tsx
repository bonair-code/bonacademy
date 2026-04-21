import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { UploadScormForm } from "./UploadScormForm";
import { BulkQuestionImport } from "./BulkQuestionImport";

async function saveExam(formData: FormData) {
  "use server";
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
    },
  });
  if (!course) notFound();

  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">{course.title}</h1>

      <section className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-semibold mb-2">SCORM Paketi</h2>
        <p className="text-xs text-slate-500 mb-2">
          Mevcut: {course.scormPackagePath ? `${course.scormPackagePath} · ${course.scormVersion}` : "Yok"}
        </p>
        <UploadScormForm courseId={course.id} />
      </section>

      <section className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-semibold mb-2">Sınav Ayarları</h2>
        <form action={saveExam} className="flex gap-2 items-end">
          <input type="hidden" name="courseId" value={course.id} />
          <label className="text-sm">
            Soru sayısı
            <input
              name="questionCount"
              type="number"
              defaultValue={course.exam?.questionCount ?? 10}
              className="border rounded px-2 py-1 block"
            />
          </label>
          <label className="text-sm">
            Geçme %
            <input
              name="passingScore"
              type="number"
              defaultValue={course.exam?.passingScore ?? 70}
              className="border rounded px-2 py-1 block"
            />
          </label>
          <button className="bg-slate-900 text-white rounded-lg px-4 py-2">Kaydet</button>
        </form>
      </section>

      <section className="bg-white border rounded-xl p-4">
        <h2 className="font-semibold mb-2">Soru Bankası ({course.questionBank?.questions.length ?? 0})</h2>
        <div className="mb-4">
          <BulkQuestionImport courseId={course.id} />
        </div>
        <form action={addQuestion} className="space-y-2 mb-4">
          <input type="hidden" name="courseId" value={course.id} />
          <textarea
            name="text"
            placeholder="Soru metni"
            className="border rounded w-full px-2 py-1"
            rows={2}
          />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <input name={`correct_${i}`} type="checkbox" title="Doğru şık" />
              <input
                name={`opt_${i}`}
                placeholder={`Şık ${i + 1}`}
                className="border rounded flex-1 px-2 py-1"
              />
            </div>
          ))}
          <button className="bg-slate-900 text-white rounded-lg px-4 py-2">Soru Ekle</button>
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
