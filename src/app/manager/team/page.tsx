import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { addDays, format } from "date-fns";
import { revalidatePath } from "next/cache";
import { createRetakeAssignment, canRequestRetakeFor } from "@/lib/scheduler/retake";
import { getTranslations } from "next-intl/server";
import { flashToast } from "@/lib/flash";

const STATUS_CLS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  SCORM_COMPLETED: "bg-teal-100 text-teal-700",
  EXAM_PASSED: "bg-emerald-100 text-emerald-700",
  EXAM_FAILED: "bg-red-100 text-red-700",
  RETAKE_REQUIRED: "bg-red-100 text-red-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-red-100 text-red-700",
};

const STATUS_KEY: Record<string, string> = {
  PENDING: "pending",
  IN_PROGRESS: "inProgress",
  SCORM_COMPLETED: "scormCompleted",
  EXAM_PASSED: "examPassed",
  EXAM_FAILED: "examFailed",
  RETAKE_REQUIRED: "retakeRequired",
  COMPLETED: "completed",
  OVERDUE: "overdue",
};

export default async function ManagerTeam() {
  const user = await requireRole("MANAGER", "ADMIN");
  const t = await getTranslations("misc");
  // Manager için "ekibim" = managerId'si kendisine bağlı olan kullanıcılar.
  // Admin tüm kullanıcıları görür.
  const where = user.role === "ADMIN" ? {} : { managerId: user.id };
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
    <Shell
      user={user}
      title={user.role === "ADMIN" ? t("manager.titleAdmin") : t("manager.titleManager")}
      subtitle={
        user.role === "ADMIN"
          ? t("manager.subtitleAdmin", { count: members.length })
          : t("manager.subtitleManager", { count: members.length })
      }
    >
      <div className="flex justify-end mb-3">
        <a
          href="/api/manager/team/pdf"
          target="_blank"
          rel="noopener"
          className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h6" />
          </svg>
          {t("manager.downloadPdf")}
        </a>
      </div>
      <div className="space-y-2">
        {members.length === 0 && (
          <p className="text-sm text-slate-500">{t("manager.noTeam")}</p>
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
                      {m.name || t("manager.noName")}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{m.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-500">
                    {t("manager.completedOf", { completed, total })}
                    {overdue > 0 && (
                      <span className="ml-2 text-red-600 font-medium">
                        {t("manager.overdueCount", { count: overdue })}
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
                  <p className="p-4 text-sm text-slate-500">{t("manager.noAssignments")}</p>
                )}
                {m.assignments.map((a) => {
                  const cls = STATUS_CLS[a.status] ?? "bg-slate-100 text-slate-600";
                  const statusKey = STATUS_KEY[a.status];
                  const statusText = statusKey
                    ? t(`manager.status.${statusKey}` as "manager.status.pending")
                    : a.status;
                  const isOverdue =
                    new Date(a.dueDate) < new Date() && a.status !== "COMPLETED";
                  // Bu kurs (plan) için aynı kullanıcıda aktif başka bir döngü var mı?
                  const hasActiveForPlan = m.assignments.some(
                    (x) =>
                      x.planId === a.planId &&
                      x.id !== a.id &&
                      x.status !== "COMPLETED"
                  );
                  const canRequestRetake =
                    a.status === "COMPLETED" && !hasActiveForPlan;
                  const defaultDue = format(addDays(new Date(), 30), "yyyy-MM-dd");
                  return (
                    <div key={a.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {a.plan.course.title}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {t("manager.cycle", { number: a.cycleNumber })} · {t("manager.dueDate")}{" "}
                            <span
                              className={isOverdue ? "text-red-600 font-medium" : ""}
                            >
                              {a.dueDate.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}
                          >
                            {statusText}
                          </span>
                        </div>
                      </div>
                      {canRequestRetake && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-sky-700 hover:underline cursor-pointer inline-block select-none">
                            {t("manager.requestRetake")}
                          </summary>
                          <form
                            action={managerRetakeAction}
                            className="mt-2 grid gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200"
                          >
                            <input type="hidden" name="assignmentId" value={a.id} />
                            <label className="text-xs text-slate-600">
                              {t("manager.reason")} <span className="text-red-600">*</span>
                              <textarea
                                name="reason"
                                required
                                minLength={5}
                                maxLength={500}
                                rows={2}
                                className="input w-full text-sm mt-1"
                                placeholder={t("manager.reasonPlaceholder")}
                              />
                            </label>
                            <label className="text-xs text-slate-600">
                              {t("manager.dueDateLabel")}
                              <input
                                type="date"
                                name="dueDate"
                                defaultValue={defaultDue}
                                className="input w-full text-sm mt-1"
                              />
                            </label>
                            <div>
                              <button className="btn-primary text-xs py-1.5">
                                {t("manager.requestRetakeButton")}
                              </button>
                            </div>
                          </form>
                        </details>
                      )}
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

async function managerRetakeAction(formData: FormData) {
  "use server";
  const actor = await requireRole("MANAGER", "ADMIN");
  const assignmentId = String(formData.get("assignmentId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const dueDateRaw = String(formData.get("dueDate") || "").trim();
  if (!assignmentId || !reason || reason.length < 5) return;

  // Hedef kullanıcı için yetki kontrolü.
  const src = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { userId: true },
  });
  if (!src) return;
  const allowed = await canRequestRetakeFor(actor, src.userId);
  if (!allowed) return;

  const customDue =
    /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? new Date(dueDateRaw) : null;

  await createRetakeAssignment({
    sourceAssignmentId: assignmentId,
    triggeredBy: "MANAGER_REQUESTED",
    triggeredById: actor.id,
    reason: reason.slice(0, 500),
    customDueDate: customDue,
  });
  await flashToast("saved");
  revalidatePath("/manager/team");
}
