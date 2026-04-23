import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deletePackage } from "@/lib/scorm/storage";
import { ConfirmButton } from "@/components/ConfirmButton";

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
          required
          maxLength={255}
          className="input flex-1"
        />
        <button className="btn-primary">Ekle</button>
      </form>
      <div className="space-y-2">
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">Henüz kurs yok.</p>
        )}
        {courses.map((c) => (
          <div
            key={c.id}
            className="card flex items-center justify-between gap-3 p-4 hover:bg-slate-50/70 transition"
          >
            <Link
              href={`/admin/courses/${c.id}`}
              className="flex-1 min-w-0"
            >
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
            </Link>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href={`/admin/courses/${c.id}`}
                className="btn-secondary text-xs"
              >
                Düzenle →
              </Link>
              <form action={deleteCourse}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton
                  className="text-xs text-red-600 hover:text-red-700 hover:underline px-2 py-1"
                  message={
                    c._count.plans > 0
                      ? `"${c.title}" kursuna bağlı ${c._count.plans} plan ve tüm atamaları silinecek. Devam edilsin mi?`
                      : `"${c.title}" kursu silinsin mi?`
                  }
                >
                  Sil
                </ConfirmButton>
              </form>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
