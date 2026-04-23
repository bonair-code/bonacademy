import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import {
  materializeAssignmentsForPlan,
  resolvePlanTargets,
} from "@/lib/scheduler/assignments";
import type { Recurrence } from "@prisma/client";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";

async function createPlan(formData: FormData) {
  "use server";
  const me = await requireRole("ADMIN");
  const courseId = String(formData.get("courseId"));
  const recurrence = String(formData.get("recurrence")) as Recurrence;
  const startDate = new Date(String(formData.get("startDate")));
  const dueInDays = Number(formData.get("dueInDays") || 30);
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);

  const plan = await prisma.trainingPlan.create({
    data: {
      courseId,
      recurrence,
      startDate,
      dueInDays,
      createdById: me.id,
      jobTitles: {
        create: jobTitleIds.map((jid) => ({ jobTitleId: jid })),
      },
    },
  });

  const targets = await resolvePlanTargets(plan.id, userIds);
  await materializeAssignmentsForPlan(plan.id, targets);
  revalidatePath("/admin/plans");
}

async function updatePlan(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const planId = String(formData.get("planId"));
  const recurrence = String(formData.get("recurrence")) as Recurrence;
  const dueInDays = Number(formData.get("dueInDays") || 30);
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);
  const extraUserIds = formData.getAll("userIds").map(String).filter(Boolean);

  // Plan meta güncelle.
  await prisma.trainingPlan.update({
    where: { id: planId },
    data: { recurrence, dueInDays },
  });

  // Görev tanımları: mevcut bağları sil, yenilerini yaz. Bu sadece plan↔jobTitle
  // ilişkisini değiştirir; kullanıcıların Assignment satırlarına dokunmaz.
  await prisma.trainingPlanJobTitle.deleteMany({ where: { planId } });
  if (jobTitleIds.length) {
    await prisma.trainingPlanJobTitle.createMany({
      data: jobTitleIds.map((jid) => ({ planId, jobTitleId: jid })),
    });
  }

  // Yeni kapsama giren kullanıcılar için eksik atamaları oluştur. Mevcut
  // kullanıcıların atamaları upsert (update: {}) sayesinde değişmeden kalır —
  // status, attempts, cmiData hepsi korunur, kaldıkları yerden devam ederler.
  const targets = await resolvePlanTargets(planId, extraUserIds);
  await materializeAssignmentsForPlan(planId, targets);

  revalidatePath("/admin/plans");
}

async function deletePlan(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const planId = String(formData.get("planId"));
  // Cascade sırası: atamalar → TrainingPlanJobTitle → plan.
  await prisma.assignment.deleteMany({ where: { planId } });
  await prisma.trainingPlanJobTitle.deleteMany({ where: { planId } });
  await prisma.trainingPlan.delete({ where: { id: planId } });
  revalidatePath("/admin/plans");
}

const RECURRENCE_LABEL: Record<string, string> = {
  NONE: "Tek seferlik",
  SIX_MONTHS: "6 ayda bir",
  ONE_YEAR: "1 yılda bir",
  TWO_YEARS: "2 yılda bir",
};

export default async function AdminPlans() {
  const user = await requireRole("ADMIN");
  const [courses, users, jobTitles, plans] = await Promise.all([
    prisma.course.findMany({ orderBy: { title: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.jobTitle.findMany({ orderBy: { name: "asc" } }),
    prisma.trainingPlan.findMany({
      include: {
        course: true,
        jobTitles: { include: { jobTitle: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <Shell user={user} title="Eğitim Planları">
      <form action={createPlan} className="card p-4 mb-6 space-y-3">
        <h2 className="font-semibold text-slate-900">Yeni Plan</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="flex items-center justify-between">
              <span>Kurs</span>
              <Link
                href="/admin/courses"
                className="text-[11px] text-teal-700 hover:underline"
              >
                + Yeni kurs oluştur
              </Link>
            </div>
            <select name="courseId" required className="input block w-full">
              {courses.length === 0 && (
                <option value="" disabled>
                  Henüz kurs yok — önce kurs ekleyin
                </option>
              )}
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Tekrar sıklığı
            <select name="recurrence" className="input block w-full">
              <option value="NONE">Tek seferlik</option>
              <option value="SIX_MONTHS">6 ayda bir</option>
              <option value="ONE_YEAR">1 yılda bir</option>
              <option value="TWO_YEARS">2 yılda bir</option>
            </select>
          </label>
          <label className="text-sm">
            Başlangıç tarihi
            <input
              name="startDate"
              type="date"
              required
              className="input block w-full"
            />
          </label>
          <label className="text-sm">
            Tamamlama süresi (gün)
            <input
              name="dueInDays"
              type="number"
              defaultValue={30}
              className="input block w-full"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            Görev tanımları (otomatik atanır)
            <select
              name="jobTitleIds"
              multiple
              className="input block w-full h-40"
            >
              {jobTitles.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            Ek kullanıcılar (opsiyonel)
            <select
              name="userIds"
              multiple
              className="input block w-full h-40"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Seçilen görev tanımındaki tüm kullanıcılar + ek kullanıcılar birlikte atanır.
          Sonradan görev tanımı atanan yeni kullanıcılara da otomatik atama yapılır.
        </p>
        <SubmitButton pendingText="Oluşturuluyor..." savedText="Oluşturuldu ✓">
          Plan Oluştur
        </SubmitButton>
      </form>

      <h2 className="font-semibold mb-2">Mevcut Planlar</h2>
      <div className="space-y-2">
        {plans.length === 0 && (
          <p className="text-sm text-slate-500">Henüz plan yok.</p>
        )}
        {plans.map((p) => {
          const currentJt = new Set(p.jobTitles.map((j) => j.jobTitleId));
          return (
            <details key={p.id} className="card group">
              <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-slate-50/70">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {p.course.title}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {RECURRENCE_LABEL[p.recurrence] ?? p.recurrence} ·{" "}
                    {p._count.assignments} atama · Başlangıç{" "}
                    {new Date(p.startDate).toLocaleDateString("tr-TR")}
                    {p.jobTitles.length > 0 && (
                      <> · {p.jobTitles.map((j) => j.jobTitle.name).join(", ")}</>
                    )}
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
              <form
                action={updatePlan}
                className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50"
              >
                <input type="hidden" name="planId" value={p.id} />
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Tekrar sıklığı
                    <select
                      name="recurrence"
                      defaultValue={p.recurrence}
                      className="input block w-full"
                    >
                      <option value="NONE">Tek seferlik</option>
                      <option value="SIX_MONTHS">6 ayda bir</option>
                      <option value="ONE_YEAR">1 yılda bir</option>
                      <option value="TWO_YEARS">2 yılda bir</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Tamamlama süresi (gün)
                    <input
                      name="dueInDays"
                      type="number"
                      defaultValue={p.dueInDays}
                      className="input block w-full"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm block">
                    Görev tanımları
                    <select
                      name="jobTitleIds"
                      multiple
                      defaultValue={Array.from(currentJt)}
                      className="input block w-full h-32"
                    >
                      {jobTitles.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm block">
                    Ek kullanıcılar (opsiyonel)
                    <select
                      name="userIds"
                      multiple
                      className="input block w-full h-32"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-slate-600">
                  <strong>Not:</strong> Yeni görev tanımı eklediğinde sadece henüz
                  ataması olmayan kullanıcılara atama üretilir. Eski kullanıcıların
                  durumu, denemeleri ve ilerlemesi korunur — kaldıkları yerden
                  devam ederler. Görev tanımını çıkarmak mevcut atamaları silmez.
                </p>
                <div className="flex items-center gap-2">
                  <SubmitButton>Değişiklikleri Kaydet</SubmitButton>
                  <button
                    type="submit"
                    formAction={deletePlan}
                    className="text-xs text-red-600 hover:underline px-2 py-1 ml-auto"
                    formNoValidate
                  >
                    Planı sil
                  </button>
                </div>
              </form>
            </details>
          );
        })}
      </div>
    </Shell>
  );
}
