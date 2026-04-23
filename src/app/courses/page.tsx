import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";

// ADMIN ve MANAGER için salt okunur kurs listesi. Yönetici raporlama
// ihtiyacı için Excel dışa aktarımı buradan yapabilir. Düzenleme ve
// SCORM/soru işlemleri hâlâ yalnızca /admin/courses altından yapılır.
export default async function CoursesReadOnly() {
  const user = await requireRole("ADMIN", "MANAGER");
  const courses = await prisma.course.findMany({
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
    include: {
      ownerManager: { select: { name: true } },
      _count: { select: { plans: true } },
    },
  });

  return (
    <Shell user={user} title="Kurslar" subtitle="Tanımlı eğitim listesi">
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-sm text-slate-500">
          Toplam {courses.length} kurs.
        </p>
        <a
          href="/api/courses/export"
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
          download
        >
          <span>📊</span> Excel Olarak İndir
        </a>
      </div>
      <div className="space-y-2">
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">Henüz kurs yok.</p>
        )}
        {courses.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-center gap-2">
              <div className="font-medium text-slate-900 truncate">
                {c.title}
              </div>
              <span className="badge-teal text-[10px] shrink-0">
                v{c.currentRevision}
              </span>
              {!c.isActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                  pasif
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {c.scormPackagePath ? "SCORM yüklü" : "SCORM bekleniyor"}
              {c._count.plans > 0 && ` · ${c._count.plans} plan`}
              {c.ownerManager
                ? ` · Sorumlu: ${c.ownerManager.name}`
                : " · Sorumlu atanmamış"}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
