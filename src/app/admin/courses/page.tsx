import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deletePackage } from "@/lib/scorm/storage";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  createCourseRevision,
  ensureBaselineRevision,
} from "@/lib/courseRevisions";

async function createCourse(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const course = await prisma.course.create({ data: { title } });
  revalidatePath("/admin/courses");
  // Yeni oluşturulan kursun detay sayfasına yönlendir ki admin hemen
  // SCORM paketi yükleyip soru bankası ekleyebilsin.
  redirect(`/admin/courses/${course.id}`);
}

async function quickUpdateCourse(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
  const courseId = String(formData.get("id"));
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const passingScore = Number(formData.get("passingScore") || 70);
  if (!title) return;

  const existing = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
  });
  const changed =
    existing.title !== title ||
    (existing.description ?? "") !== description ||
    existing.passingScore !== passingScore;

  if (!changed) return;

  // Eski sürümü revision tablosuna düşür — geçmiş atamalar "Atama: v{N}"
  // rozetiyle hangi içeriği almış olduğunu görmeye devam eder.
  await ensureBaselineRevision(existing, admin.id);

  await prisma.course.update({
    where: { id: courseId },
    data: { title, description: description || null, passingScore },
  });

  await createCourseRevision(courseId, admin.id, "Meta güncellendi (liste)");
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
}

async function deleteCourse(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const course = await prisma.course.findUnique({
    where: { id },
    select: { scormPackagePath: true },
  });
  if (!course) return;
  const plans = await prisma.trainingPlan.findMany({
    where: { courseId: id },
    select: { id: true },
  });
  const planIds = plans.map((p) => p.id);
  if (planIds.length) {
    await prisma.assignment.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.trainingPlanJobTitle.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.trainingPlan.deleteMany({ where: { id: { in: planIds } } });
  }
  await prisma.course.delete({ where: { id } });
  if (course.scormPackagePath) {
    try {
      await deletePackage(course.scormPackagePath);
    } catch {}
  }
  revalidatePath("/admin/courses");
}

export default async function AdminCourses() {
  const user = await requireRole("ADMIN");
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { plans: true } },
    },
  });
  return (
    <Shell user={user} title="Kurslar" subtitle="SCORM paketleri ve soru bankaları">
      <form action={createCourse} className="flex gap-2 mb-6">
        <input
          name="title"
          placeholder="Yeni kurs başlığı"
          className="input flex-1"
        />
        <button className="btn-primary">Ekle</button>
      </form>
      <div className="space-y-2">
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">Henüz kurs yok.</p>
        )}
        {courses.map((c) => (
          <details key={c.id} className="card group">
            <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none select-none hover:bg-slate-50/70 rounded-xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-slate-900 truncate">
                    {c.title}
                  </div>
                  <span className="badge-teal text-[10px] shrink-0">
                    v{c.currentRevision}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {c.scormPackagePath ? "SCORM yüklü" : "SCORM bekleniyor"}
                  {c._count.plans > 0 && ` · ${c._count.plans} plan`}
                </div>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
              <form action={quickUpdateCourse} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <label className="text-sm block">
                  Başlık
                  <input
                    name="title"
                    defaultValue={c.title}
                    className="input block w-full"
                    required
                  />
                </label>
                <label className="text-sm block">
                  Açıklama
                  <textarea
                    name="description"
                    defaultValue={c.description ?? ""}
                    rows={2}
                    className="input block w-full"
                  />
                </label>
                <label className="text-sm block w-40">
                  Geçme notu (%)
                  <input
                    name="passingScore"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={c.passingScore}
                    className="input block w-full"
                  />
                </label>
                <p className="text-xs text-slate-600">
                  <strong>Not:</strong> Kaydettiğinde yeni bir sürüm (revision)
                  oluşur; geçmiş atamalar, sertifikalar ve sınav denemeleri hangi
                  sürümde yapıldıysa o sürümle işaretli kalır. Aktif öğrenciler
                  kaldıkları yerden devam eder. SCORM paketi yüklemek, soru
                  eklemek veya revizyon geçmişini görmek için
                  <strong> detay sayfasını</strong> kullanın.
                </p>
                <div className="flex items-center gap-2">
                  <button className="btn-primary">Değişiklikleri Kaydet</button>
                  <Link
                    href={`/admin/courses/${c.id}`}
                    className="btn-secondary text-xs"
                  >
                    Detay Sayfası →
                  </Link>
                </div>
              </form>
              <form action={deleteCourse} className="pt-2 border-t border-slate-200">
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton
                  className="text-xs text-red-600 hover:text-red-700 hover:underline px-2 py-1"
                  message={
                    c._count.plans > 0
                      ? `"${c.title}" kursuna bağlı ${c._count.plans} plan ve tüm atamaları silinecek. Devam edilsin mi?`
                      : `"${c.title}" kursu silinsin mi?`
                  }
                >
                  Kursu sil
                </ConfirmButton>
              </form>
            </div>
          </details>
        ))}
      </div>
    </Shell>
  );
}
