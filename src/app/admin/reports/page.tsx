import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";

export default async function AdminReports() {
  const user = await requireRole("ADMIN");
  const stats = await prisma.assignment.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">Raporlar</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.status} className="bg-white border rounded-xl p-4">
            <div className="text-xs text-slate-500">{s.status}</div>
            <div className="text-2xl font-semibold">{s._count._all}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <a
          href="/api/reports/assignments.xlsx"
          className="bg-slate-900 text-white rounded-lg px-4 py-2"
        >
          Excel Raporu İndir
        </a>
      </div>
    </Shell>
  );
}
