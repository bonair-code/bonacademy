import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";

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
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">Ekibim</h1>
      <div className="space-y-4">
        {members.map((m) => (
          <div key={m.id} className="bg-white border rounded-xl p-4">
            <div className="font-semibold mb-1">
              {m.name} <span className="text-slate-500 font-normal">· {m.email}</span>
            </div>
            <ul className="text-sm text-slate-600 list-disc pl-5">
              {m.assignments.length === 0 && <li>Atama yok</li>}
              {m.assignments.map((a) => (
                <li key={a.id}>
                  {a.plan.course.title} — {a.status} — son tarih{" "}
                  {a.dueDate.toLocaleDateString("tr-TR")}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Shell>
  );
}
