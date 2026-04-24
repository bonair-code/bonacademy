import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { fmtTrDate } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRetakeAssignment } from "@/lib/scheduler/retake";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

// Kullanıcının tamamlanan eğitimleri geçmişi. Her kurs için en son tamamlanan
// döngü gösterilir; "Tekrar Et" butonu ile gönüllü yeni döngü başlatılabilir.
export default async function MyTrainingsHistoryPage() {
  const user = await requireUser();
  const t = await getTranslations("user");

  const completed = await prisma.assignment.findMany({
    where: { userId: user.id, status: "COMPLETED" },
    include: {
      plan: {
        include: { course: { select: { id: true, title: true, currentRevision: true } } },
      },
      certificate: { select: { id: true, serialNo: true } },
    },
    orderBy: { completedAt: "desc" },
  });

  // Aynı plan+user için aktif (tamamlanmamış) atama var mı? Buton gösterimi
  // için tek sorguda çekip Map'liyoruz — N+1 olmaz.
  const planIds = Array.from(new Set(completed.map((a) => a.planId)));
  const actives = planIds.length
    ? await prisma.assignment.findMany({
        where: {
          userId: user.id,
          planId: { in: planIds },
          status: {
            in: [
              "PENDING",
              "IN_PROGRESS",
              "SCORM_COMPLETED",
              "EXAM_FAILED",
              "RETAKE_REQUIRED",
              "OVERDUE",
            ],
          },
        },
        select: { planId: true },
      })
    : [];
  const activePlanIds = new Set(actives.map((a) => a.planId));

  // Aynı kursun birden fazla tamamlanmış döngüsü varsa, sadece en sonuncusunu
  // listeliyoruz — eski döngüler "Sertifikalarım" sayfasında zaten görünür.
  const seenPlans = new Set<string>();
  const latestPerPlan = completed.filter((a) => {
    if (seenPlans.has(a.planId)) return false;
    seenPlans.add(a.planId);
    return true;
  });

  return (
    <Shell
      user={user}
      title={t("history.title")}
      subtitle={t("history.subtitle")}
    >
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3 font-medium">{t("history.col.training")}</th>
              <th className="text-left p-3 font-medium">{t("history.col.completion")}</th>
              <th className="text-left p-3 font-medium">{t("history.col.cycle")}</th>
              <th className="text-left p-3 font-medium">{t("history.col.certificate")}</th>
              <th className="text-right p-3 font-medium">{t("history.col.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {latestPerPlan.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  {t("history.empty")}
                </td>
              </tr>
            )}
            {latestPerPlan.map((a) => {
              const hasActive = activePlanIds.has(a.planId);
              return (
                <tr key={a.id} className="hover:bg-slate-50 align-top">
                  <td className="p-3 font-medium text-slate-900">
                    {a.plan.course.title}
                  </td>
                  <td className="p-3 text-slate-700 whitespace-nowrap">
                    {a.completedAt ? fmtTrDate(a.completedAt) : "—"}
                  </td>
                  <td className="p-3 text-slate-600">{a.cycleNumber}</td>
                  <td className="p-3">
                    {a.certificate ? (
                      <a
                        className="text-sky-700 hover:underline text-xs"
                        href={`/api/certificate/${a.certificate.id}`}
                      >
                        {t("history.pdfSuffix", { serial: a.certificate.serialNo })}
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {hasActive ? (
                      <span className="text-xs text-slate-400">
                        {t("history.hasActive")}
                      </span>
                    ) : (
                      <form action={voluntaryRetakeAction}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button className="btn-secondary text-xs py-1.5">
                          {t("history.retake")}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 mt-3">
        {t("history.footNote")}
      </p>
    </Shell>
  );
}

async function voluntaryRetakeAction(formData: FormData) {
  "use server";
  const user = await requireUser();
  const assignmentId = String(formData.get("assignmentId") || "").trim();
  if (!assignmentId) return;

  // Güvenlik: yalnızca kendi assignment'ı için tekrar başlatabilir.
  const src = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { userId: true },
  });
  if (!src || src.userId !== user.id) return;

  const res = await createRetakeAssignment({
    sourceAssignmentId: assignmentId,
    triggeredBy: "VOLUNTARY",
    triggeredById: user.id,
  });
  if (res.ok) {
    revalidatePath("/dashboard");
    revalidatePath("/my-trainings/history");
    redirect(`/course/${res.assignmentId}`);
  }
  revalidatePath("/my-trainings/history");
}
