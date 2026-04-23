import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "Bekliyor", cls: "bg-slate-100 text-slate-600" },
  IN_PROGRESS: { text: "Devam Ediyor", cls: "bg-amber-100 text-amber-700" },
  SCORM_COMPLETED: { text: "Sınav Bekliyor", cls: "bg-teal-100 text-teal-700" },
  EXAM_PASSED: { text: "Sınav Geçti", cls: "bg-emerald-100 text-emerald-700" },
  EXAM_FAILED: { text: "Sınav Başarısız", cls: "bg-red-100 text-red-700" },
  RETAKE_REQUIRED: { text: "Tekrar Gerekli", cls: "bg-red-100 text-red-700" },
  COMPLETED: { text: "Tamamlandı", cls: "bg-emerald-100 text-emerald-700" },
  OVERDUE: { text: "Gecikmiş", cls: "bg-red-100 text-red-700" },
};

export default async function ManagerTeam() {
  const user = await requireRole("MANAGER", "ADMIN");
  const where = user.role === "ADMIN" ? {} : { departmentId: user.departmentId ?? "__none__" };
  const members = await prisma.user.findMany({
    where,
    include: {
      assignments: {
        include: { plan: { include: { course: true } } },
        orderBy: { dueDate: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <Shell user={user} title="Ekibim" subtitle={`${members.length} kişi`}>
      <div className="space-y-2">
        {members.length === 0 && (
          <p className="text-sm text-slate-500">Ekibinde kayıtlı kullanıcı yok.</p>
        )}
        {members.map((m) => {
          const total = m.assignments.length;
          const completed = m.assignments.filter(
            (a) => a.status === "COMPLETED" || a.status === "EXAM_PASSED"
          ).length;
          const overdue = m.assignments.filter(
            (a) => a.status === "OVERDUE" || new Date(a.dueDate) < new Date()
          ).length;
          const initials = (m.name || m.email)
            .split(" ")
            .map((s) => s[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase();
          return (
            <details key={m.id} className="card group">
              <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-slate-50/70 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {initials || "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {m.name || "(isim yok)"}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{m.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500">
                    {completed}/{total} tamamlandı
                    {overdue > 0 && (
                      <span className="ml-2 text-red-600 font-medium">
                        {overdue} gecikmiş
                      </span>
                    )}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </summary>
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {m.assignments.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">Atama yok.</p>
                )}
                {m.assignments.map((a) => {
                  const s = STATUS_LABEL[a.status] || {
                    text: a.status,
                    cls: "bg-slate-100 text-slate-600",
                  };
                  const isOverdue =
                    new Date(a.dueDate) < new Date() && a.status !== "COMPLETED";
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {a.plan.course.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Döngü {a.cycleNumber} · Son tarih{" "}
                          <span
                            className={isOverdue ? "text-red-600 font-medium" : ""}
                          >
                            {a.dueDate.toLocaleDateString("tr-TR")}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${s.cls}`}
                      >
                        {s.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </Shell>
  );
}
