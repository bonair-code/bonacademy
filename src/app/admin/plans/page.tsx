import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import {
  materializeAssignmentsForPlan,
  resolvePlanTargets,
} from "@/lib/scheduler/assignments";
import type { Recurrence } from "@prisma/client";

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
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">Eğitim Planları</h1>
      <form action={createPlan} className="bg-white border rounded-xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Kurs
            <select name="courseId" required className="border rounded px-2 py-1 block w-full">
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Tekrar sıklığı
            <select name="recurrence" className="border rounded px-2 py-1 block w-full">
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
              className="border rounded px-2 py-1 block w-full"
            />
          </label>
          <label className="text-sm">
            Tamamlama süresi (gün)
            <input
              name="dueInDays"
              type="number"
              defaultValue={30}
              className="border rounded px-2 py-1 block w-full"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm block">
            Görev tanımları (otomatik atanır)
            <select
              name="jobTitleIds"
              multiple
              className="border rounded px-2 py-1 block w-full h-40"
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
              className="border rounded px-2 py-1 block w-full h-40"
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
          Yeni eklenen kullanıcılar için de görev tanımı üzerinden otomatik atama olur.
        </p>
        <button className="bg-slate-900 text-white rounded-lg px-4 py-2">Plan Oluştur</button>
      </form>

      <h2 className="font-semibold mb-2">Mevcut Planlar</h2>
      <div className="bg-white border rounded-xl divide-y">
        {plans.map((p) => (
          <div key={p.id} className="p-4 flex justify-between">
            <div>
              <div className="font-medium">{p.course.title}</div>
              <div className="text-xs text-slate-500">
                Tekrar: {p.recurrence} · Atama: {p._count.assignments}
                {p.jobTitles.length > 0 && (
                  <> · Görevler: {p.jobTitles.map((j) => j.jobTitle.name).join(", ")}</>
                )}
              </div>
            </div>
            <div className="text-sm text-slate-500">
              {new Date(p.startDate).toLocaleDateString("tr-TR")}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
