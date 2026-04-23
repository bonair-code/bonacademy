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
  const ownerManagerId = String(formData.get("ownerManagerId") || "").trim();
  if (!title) return;
  if (!ownerManagerId) {
    throw new Error("Kurstan sorumlu yönetici seçilmelidir.");
  }
  // Seçilen kullanıcı gerçekten MANAGER mi? Form manipülasyonuna karşı
  // sunucu tarafında da doğrula.
  const owner = await prisma.user.findUnique({
    where: { id: ownerManagerId },
    select: { id: true, role: true, isActive: true },
  });
  if (!owner || owner.role !== "MANAGER" || !owner.isActive) {
    throw new Error("Geçersiz sorumlu yönetici seçimi.");
  }
  // Aynı isimde ikinci bir eğitim oluşturulmasın (büyük/küçük harf
  // duyarsız). Böylece sonradan plan oluştururken aynı ada sahip iki
  // kurs arasında karışıklık yaşanmaz.
  const duplicate = await prisma.course.findFirst({
    where: { title: { equals: title, mode: "insensitive" } },
    select: { id: true, title: true },
  });
  if (duplicate) {
    throw new Error(`Bu isimde bir eğitim zaten var: "${duplicate.title}"`);
  }
  const course = await prisma.course.create({ data: { title, ownerManagerId } });
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
  const [courses, managers] = await Promise.all([
    prisma.course.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { plans: true } },
        ownerManager: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "MANAGER", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <Shell user={user} title="Kurslar" subtitle="SCORM paketleri ve soru bankaları">
      <form action={createCourse} className="card p-4 mb-6 space-y-3">
        <h2 className="font-semibold text-slate-900">Yeni Kurs</h2>
        <label className="text-sm block">
          Başlık
          <input
            name="title"
            placeholder="Kurs başlığı"
            required
            maxLength={255}
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-sm block">
          Sorumlu yönetici <span className="text-red-600">*</span>
          <select name="ownerManagerId" required className="input mt-1 w-full" defaultValue="">
            <option value="" disabled>
              {managers.length === 0
                ? "Önce bir MANAGER kullanıcı tanımlayın"
                : "Yönetici seçin..."}
            </option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500 mt-1 block">
            Bu kursun sahibi olarak sertifikalarda görünecek ve içerik sorumluluğunu
            üstlenecek yönetici.
          </span>
        </label>
        <button className="btn-primary" disabled={managers.length === 0}>
          Ekle
        </button>
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
                {c.ownerManager ? ` · Sorumlu: ${c.ownerManager.name}` : " · Sorumlu atanmamış"}
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
