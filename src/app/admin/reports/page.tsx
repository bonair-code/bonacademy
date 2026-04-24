import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { fmtTrDate } from "@/lib/dates";

// Rapor sayfası: Excel indirmeden de yönetimin "tek bakışta" görmesi gereken
// tüm temel analizleri burada sunuyoruz. Grafikler harici kütüphane olmadan
// inline SVG ile çiziliyor — bundle yükü yok, SSR-safe.

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  PENDING: { label: "Bekliyor", color: "#64748b", bg: "bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "Devam Ediyor", color: "#f59e0b", bg: "bg-amber-100 text-amber-700" },
  SCORM_COMPLETED: { label: "Sınav Bekliyor", color: "#14b8a6", bg: "bg-teal-100 text-teal-700" },
  EXAM_PASSED: { label: "Sınav Geçti", color: "#10b981", bg: "bg-emerald-100 text-emerald-700" },
  EXAM_FAILED: { label: "Sınav Başarısız", color: "#ef4444", bg: "bg-red-100 text-red-700" },
  RETAKE_REQUIRED: { label: "Tekrar Gerekli", color: "#dc2626", bg: "bg-red-100 text-red-700" },
  COMPLETED: { label: "Tamamlandı", color: "#059669", bg: "bg-emerald-100 text-emerald-700" },
  OVERDUE: { label: "Gecikmiş", color: "#b91c1c", bg: "bg-red-100 text-red-700" },
};

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** Inline SVG donut chart: segments = [{ label, value, color }] */
function Donut({
  segments,
  size = 180,
  thickness = 24,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        <circle r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={i}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}

/** Horizontal bar chart with labels + values */
function HBar({
  rows,
  max,
  valueSuffix = "",
}: {
  rows: { label: string; value: number; color?: string; sub?: string }[];
  max?: number;
  valueSuffix?: string;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-slate-700 truncate">{r.label}</span>
            <span className="text-slate-500 shrink-0">
              {r.value}
              {valueSuffix}
              {r.sub && <span className="text-slate-400"> · {r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.value / m) * 100}%`,
                background: r.color ?? "#14b8a6",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Line chart — inline SVG polyline + area fill + labeled axis */
function LineChart({
  points,
  width = 560,
  height = 180,
  color = "#0d9488",
}: {
  points: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (points.length === 0) return null;
  const pad = { t: 12, r: 12, b: 28, l: 32 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const xy = points.map((p, i) => ({
    x: pad.l + i * step,
    y: pad.t + h - (p.value / maxV) * h,
  }));
  const poly = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    `${xy[0].x},${pad.t + h} ` +
    poly +
    ` ${xy[xy.length - 1].x},${pad.t + h}`;
  const yTicks = 4;
  return (
    <svg width={width} height={height} className="max-w-full">
      {/* grid */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const y = pad.t + (h * i) / yTicks;
        const v = Math.round((maxV * (yTicks - i)) / yTicks);
        return (
          <g key={i}>
            <line
              x1={pad.l}
              x2={pad.l + w}
              y1={y}
              y2={y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <text
              x={pad.l - 6}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill="#94a3b8"
            >
              {v}
            </text>
          </g>
        );
      })}
      {/* area */}
      <polygon points={area} fill={color} fillOpacity={0.08} />
      {/* line */}
      <polyline
        points={poly}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* dots + x labels */}
      {xy.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={color} />
          <text
            x={p.x}
            y={pad.t + h + 16}
            textAnchor="middle"
            fontSize={10}
            fill="#64748b"
          >
            {points[i].label}
          </text>
          <text
            x={p.x}
            y={p.y - 8}
            textAnchor="middle"
            fontSize={9}
            fill="#334155"
          >
            {points[i].value || ""}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "teal" | "amber" | "red" | "green" | "slate" | "violet";
}) {
  const numCls =
    tone === "teal"
      ? "text-teal-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "red"
      ? "text-red-600"
      : tone === "green"
      ? "text-emerald-600"
      : tone === "violet"
      ? "text-violet-600"
      : "text-slate-800";
  return (
    <div className="card p-4">
      <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-400">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${numCls}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// Ayın başı (UTC) — groupBy yerine uygulama tarafında aylara kırıyoruz, SQL
// bağımsız ve Postgres/SQLite farkından etkilenmiyor.
function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const TR_MONTHS = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

export default async function AdminReports() {
  const user = await requireRole("ADMIN");

  const now = new Date();
  const sixMonthsAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
  );

  const [
    statusCounts,
    totalActiveUsers,
    totalCertificates,
    completedInWindow,
    certsInWindow,
    coursesWithAssignments,
    departmentsWithUsers,
    examAttemptsAgg,
    examAttemptsGrouped,
    topOverdue,
  ] = await Promise.all([
    prisma.assignment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.count({ where: { isActive: true, role: "USER" } }),
    prisma.certificate.count(),
    prisma.assignment.findMany({
      where: { completedAt: { gte: sixMonthsAgo, not: null } },
      select: { completedAt: true },
    }),
    prisma.certificate.findMany({
      where: { issuedAt: { gte: sixMonthsAgo } },
      select: { issuedAt: true },
    }),
    prisma.course.findMany({
      select: {
        id: true,
        title: true,
        plans: {
          select: {
            assignments: {
              select: { status: true },
            },
          },
        },
      },
    }),
    prisma.department.findMany({
      select: {
        id: true,
        name: true,
        users: {
          where: { isActive: true, role: "USER" },
          select: {
            assignments: { select: { status: true, dueDate: true } },
          },
        },
      },
    }),
    prisma.examAttempt.aggregate({
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.examAttempt.groupBy({
      by: ["attemptNo", "passed"],
      _count: { _all: true },
    }),
    prisma.assignment.findMany({
      where: { status: "OVERDUE" },
      orderBy: { dueDate: "asc" },
      take: 10,
      include: {
        user: { select: { name: true, email: true } },
        plan: { include: { course: { select: { title: true } } } },
      },
    }),
  ]);

  // Toplam atama + durumlara göre dağılım
  const totalAssignments = statusCounts.reduce((s, x) => s + x._count._all, 0);
  const countBy: Record<string, number> = {};
  for (const s of statusCounts) countBy[s.status] = s._count._all;
  const completedCount =
    (countBy["COMPLETED"] ?? 0) + (countBy["EXAM_PASSED"] ?? 0);
  const overdueCount = countBy["OVERDUE"] ?? 0;
  const inProgressCount =
    (countBy["IN_PROGRESS"] ?? 0) +
    (countBy["SCORM_COMPLETED"] ?? 0) +
    (countBy["EXAM_FAILED"] ?? 0) +
    (countBy["RETAKE_REQUIRED"] ?? 0);
  const compliancePct = pct(completedCount, totalAssignments);

  // Son 6 ay — tamamlanan + sertifika trend
  const months: { key: string; label: string; d: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: monthKey(d), label: TR_MONTHS[d.getUTCMonth()], d });
  }
  const completedByMonth: Record<string, number> = Object.fromEntries(
    months.map((m) => [m.key, 0])
  );
  for (const c of completedInWindow) {
    if (!c.completedAt) continue;
    const k = monthKey(startOfMonthUTC(c.completedAt));
    if (k in completedByMonth) completedByMonth[k]++;
  }
  const certsByMonth: Record<string, number> = Object.fromEntries(
    months.map((m) => [m.key, 0])
  );
  for (const c of certsInWindow) {
    const k = monthKey(startOfMonthUTC(c.issuedAt));
    if (k in certsByMonth) certsByMonth[k]++;
  }

  // Kursa göre tamamlanma oranı (en az 1 ataması olanlar)
  const courseRows = coursesWithAssignments
    .map((c) => {
      const all = c.plans.flatMap((p) => p.assignments);
      const total = all.length;
      const done = all.filter(
        (a) => a.status === "COMPLETED" || a.status === "EXAM_PASSED"
      ).length;
      return {
        label: c.title,
        total,
        done,
        rate: pct(done, total),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);

  // Departman uyum oranı
  const deptRows = departmentsWithUsers
    .map((d) => {
      const all = d.users.flatMap((u) => u.assignments);
      const total = all.length;
      const done = all.filter(
        (a) => a.status === "COMPLETED" || a.status === "EXAM_PASSED"
      ).length;
      const overdue = all.filter(
        (a) =>
          a.status === "OVERDUE" ||
          (new Date(a.dueDate) < now && a.status !== "COMPLETED")
      ).length;
      return {
        label: d.name,
        userCount: d.users.length,
        total,
        done,
        overdue,
        rate: pct(done, total),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.rate - a.rate);

  // Sınav: ilk denemede geçme oranı
  let firstTryPass = 0;
  let firstTryTotal = 0;
  for (const g of examAttemptsGrouped) {
    if (g.attemptNo === 1) {
      firstTryTotal += g._count._all;
      if (g.passed) firstTryPass += g._count._all;
    }
  }
  const firstTryRate = pct(firstTryPass, firstTryTotal);
  const avgScore = examAttemptsAgg._avg.score ?? 0;

  // Donut segmentleri (status)
  const donutSegments = Object.entries(countBy)
    .filter(([, v]) => v > 0)
    .map(([status, value]) => ({
      label: STATUS_META[status]?.label ?? status,
      value,
      color: STATUS_META[status]?.color ?? "#94a3b8",
    }));

  return (
    <Shell user={user} title="Raporlar" subtitle="Genel analiz ve grafikler">
      {/* KPI şeridi */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Kpi
          label="Toplam Atama"
          value={totalAssignments}
          tone="slate"
          sub={`${totalActiveUsers} aktif kullanıcı`}
        />
        <Kpi
          label="Uyum Oranı"
          value={`%${compliancePct}`}
          tone="green"
          sub={`${completedCount} tamamlandı`}
        />
        <Kpi
          label="Devam Eden"
          value={inProgressCount}
          tone="amber"
        />
        <Kpi
          label="Geciken"
          value={overdueCount}
          tone="red"
        />
        <Kpi
          label="Sertifika"
          value={totalCertificates}
          tone="teal"
        />
        <Kpi
          label="İlk Deneme Geçme"
          value={`%${firstTryRate}`}
          tone="violet"
          sub={`${firstTryTotal} sınav`}
        />
      </div>

      {/* İlk satır: durum donut + aylık trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">
            Atama Durum Dağılımı
          </h2>
          {totalAssignments === 0 ? (
            <p className="text-sm text-slate-500">Henüz atama yok.</p>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <div className="relative">
                <Donut segments={donutSegments} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-2xl font-bold text-slate-900">
                    {totalAssignments}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Atama
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 flex-1 min-w-[180px]">
                {donutSegments.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-slate-700 flex-1 truncate">
                      {s.label}
                    </span>
                    <span className="text-slate-900 font-medium">
                      {s.value}
                    </span>
                    <span className="text-slate-400">
                      %{pct(s.value, totalAssignments)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">
            Son 6 Ay · Tamamlanan Eğitim
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Aylık tamamlanma sayısı (completedAt tarihine göre).
          </p>
          <LineChart
            points={months.map((m) => ({
              label: m.label,
              value: completedByMonth[m.key],
            }))}
          />
          <div className="mt-4 pt-4 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              Sertifika Üretimi (aylık)
            </h3>
            <LineChart
              points={months.map((m) => ({
                label: m.label,
                value: certsByMonth[m.key],
              }))}
              height={140}
              color="#0ea5e9"
            />
          </div>
        </div>
      </div>

      {/* İkinci satır: kurs tamamlanma + departman uyum */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">
            Kurs Bazında Tamamlanma Oranı
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            En yüksek 8 kurs (yalnızca ataması olanlar).
          </p>
          {courseRows.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz veri yok.</p>
          ) : (
            <HBar
              rows={courseRows.map((c) => ({
                label: c.label,
                value: c.rate,
                sub: `${c.done}/${c.total}`,
                color:
                  c.rate >= 80
                    ? "#10b981"
                    : c.rate >= 50
                    ? "#f59e0b"
                    : "#ef4444",
              }))}
              max={100}
              valueSuffix="%"
            />
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">
            Departman Uyum Oranı
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Kullanıcı atamaları üzerinden tamamlanma yüzdesi.
          </p>
          {deptRows.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz veri yok.</p>
          ) : (
            <HBar
              rows={deptRows.map((d) => ({
                label: d.label,
                value: d.rate,
                sub: `${d.userCount} kişi · ${d.overdue} geciken`,
                color:
                  d.rate >= 80
                    ? "#10b981"
                    : d.rate >= 50
                    ? "#f59e0b"
                    : "#ef4444",
              }))}
              max={100}
              valueSuffix="%"
            />
          )}
        </div>
      </div>

      {/* Üçüncü: sınav performansı + en çok geciken */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">
            Sınav Performansı
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">Ortalama Puan</div>
              <div className="text-2xl font-bold text-violet-600 mt-1">
                {avgScore ? avgScore.toFixed(1) : "—"}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {examAttemptsAgg._count._all} deneme
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">İlk Deneme Geçme</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                %{firstTryRate}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {firstTryPass}/{firstTryTotal}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Deneme Numarasına Göre
            </h3>
            {(() => {
              const byAttempt: Record<number, { pass: number; fail: number }> = {};
              for (const g of examAttemptsGrouped) {
                byAttempt[g.attemptNo] ??= { pass: 0, fail: 0 };
                if (g.passed) byAttempt[g.attemptNo].pass += g._count._all;
                else byAttempt[g.attemptNo].fail += g._count._all;
              }
              const sorted = Object.entries(byAttempt)
                .map(([k, v]) => ({ n: Number(k), ...v }))
                .sort((a, b) => a.n - b.n);
              if (sorted.length === 0)
                return (
                  <p className="text-xs text-slate-500">Henüz sınav yok.</p>
                );
              return sorted.map((s) => {
                const total = s.pass + s.fail;
                const rate = pct(s.pass, total);
                return (
                  <div key={s.n}>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700">{s.n}. deneme</span>
                      <span className="text-slate-500">
                        %{rate} · {s.pass}/{total}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(s.pass / total) * 100}%` }}
                      />
                      <div
                        className="h-full bg-red-400"
                        style={{ width: `${(s.fail / total) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">
            En Çok Geciken 10 Atama
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Son tarihi en erken geçmiş olanlar üstte.
          </p>
          {topOverdue.length === 0 ? (
            <p className="text-sm text-slate-500">Geciken atama yok 🎉</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {topOverdue.map((a) => {
                const daysLate = Math.floor(
                  (now.getTime() - new Date(a.dueDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {a.user.name || a.user.email}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {a.plan.course.title} · Son tarih{" "}
                        {fmtTrDate(a.dueDate)}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-red-600 shrink-0">
                      {daysLate} gün
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Excel indirme — yine de erişilebilir */}
      <div className="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Detaylı Dışa Aktarım</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm atamalar satır bazında, filtre + pivot için Excel.
          </p>
        </div>
        <a
          href="/api/reports/assignments.xlsx"
          className="btn-primary text-sm py-2 inline-flex items-center gap-2"
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15l3 3 3-3" />
          </svg>
          Excel İndir
        </a>
      </div>
    </Shell>
  );
}
