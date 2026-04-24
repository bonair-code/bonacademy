import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { getTranslations } from "next-intl/server";

// ADMIN ve MANAGER için salt okunur kurs listesi. Yönetici raporlama
// ihtiyacı için Excel dışa aktarımı buradan yapabilir. Düzenleme ve
// SCORM/soru işlemleri hâlâ yalnızca /admin/courses altından yapılır.
export default async function CoursesReadOnly() {
  const user = await requireRole("ADMIN", "MANAGER");
  const t = await getTranslations("misc");
  const courses = await prisma.course.findMany({
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
    include: {
      ownerManager: { select: { name: true } },
      _count: { select: { plans: true } },
    },
  });

  return (
    <Shell user={user} title={t("coursesPublic.title")} subtitle={t("coursesPublic.subtitle")}>
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-sm text-slate-500">
          {t("coursesPublic.total", { count: courses.length })}
        </p>
        <a
          href="/api/courses/export"
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
          download
        >
          <span>📊</span> {t("coursesPublic.downloadExcel")}
        </a>
      </div>
      <div className="space-y-2">
        {courses.length === 0 && (
          <p className="text-sm text-slate-500">{t("coursesPublic.noCourses")}</p>
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
                  {t("coursesPublic.inactive")}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {c.scormPackagePath ? t("coursesPublic.scormUploaded") : t("coursesPublic.scormPending")}
              {c._count.plans > 0 && t("coursesPublic.planCount", { count: c._count.plans })}
              {c.ownerManager
                ? t("coursesPublic.owner", { name: c.ownerManager.name ?? "" })
                : t("coursesPublic.noOwner")}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
