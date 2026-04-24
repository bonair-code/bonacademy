import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { fmtTrDate } from "@/lib/dates";
import { getTranslations } from "next-intl/server";

// Rapor sayfası: Excel indirmeden de yönetimin "tek bakışta" görmesi gereken
// tüm temel analizleri burada sunuyoruz. Grafikler harici kütüphane olmadan
// inline SVG ile çiziliyor — bundle yükü yok, SSR-safe.

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

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#64748b",
  IN_PROGRESS: "#f59e0b",
  SCORM_COMPLETED: "#14b8a6",
  EXAM_PASSED: "#10b981",
  EXAM_FAILED: "#ef4444",
  RETAKE_REQUIRED: "#dc2626",
  COMPLETED: "#059669",
  OVERDUE: "#b91c1c",
};

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

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
      <polygon points={area} fill={color} fillOpacity={0.08} />
      <polyline
        points={poly}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

export default async function AdminReports() {
  const t = await getTranslations("admin.reports");
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

  const months: { key: string; label: string; d: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: monthKey(d), label: t(`months.${MONTH_KEYS[d.getUTCMonth()]}` as never), d });
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

  const donutSegments = Object.entries(countBy)
    .filter(([, v]) => v > 0)
    .map(([status, value]) => ({
      label: STATUS_KEY[status] ? t(`status.${STATUS_KEY[status]}` as never) : status,
      value,
      color: STATUS_COLOR[status] ?? "#94a3b8",
    }));

  return (
    <Shell user={user} title={t("title")} subtitle={t("subtitle")}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Kpi
          label={t("kpi.totalAssignments")}
          value={totalAssignments}
          tone="slate"
          sub={t("kpi.activeUsersSub", { count: totalActiveUsers })}
        />
        <Kpi
          label={t("kpi.complianceRate")}
          value={`%${compliancePct}`}
          tone="green"
          sub={t("kpi.completedSub", { count: completedCount })}
        />
        <Kpi
          label={t("kpi.inProgress")}
          value={inProgressCount}
          tone="amber"
        />
        <Kpi
          label={t("kpi.overdue")}
          value={overdueCount}
          tone="red"
        />
        <Kpi
          label={t("kpi.certificates")}
          value={totalCertificates}
          tone="teal"
        />
        <Kpi
          label={t("kpi.firstTryPass")}
          value={`%${firstTryRate}`}
          tone="violet"
          sub={t("kpi.examsSub", { count: firstTryTotal })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">
            {t("statusDistribution")}
          </h2>
          {totalAssignments === 0 ? (
            <p className="text-sm text-slate-500">{t("noAssignments")}</p>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <div className="relative">
                <Donut segments={donutSegments} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-2xl font-bold text-slate-900">
                    {totalAssignments}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t("assignmentLabel")}
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
            {t("last6MonthsCompleted")}
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            {t("last6MonthsHelp")}
          </p>
          <LineChart
            points={months.map((m) => ({
              label: m.label,
              value: completedByMonth[m.key],
            }))}
          />
          <div className="mt-4 pt-4 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              {t("certsMonthly")}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">
            {t("coursesCompletion")}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {t("coursesCompletionHelp")}
          </p>
          {courseRows.length === 0 ? (
            <p className="text-sm text-slate-500">{t("noData")}</p>
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
            {t("departmentCompliance")}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {t("departmentComplianceHelp")}
          </p>
          {deptRows.length === 0 ? (
            <p className="text-sm text-slate-500">{t("noData")}</p>
          ) : (
            <HBar
              rows={deptRows.map((d) => ({
                label: d.label,
                value: d.rate,
                sub: t("deptSub", { users: d.userCount, overdue: d.overdue }),
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">
            {t("examPerformance")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{t("averageScore")}</div>
              <div className="text-2xl font-bold text-violet-600 mt-1">
                {avgScore ? avgScore.toFixed(1) : "—"}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {t("attemptsSub", { count: examAttemptsAgg._count._all })}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{t("firstTryPassTitle")}</div>
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
              {t("byAttemptNumber")}
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
                  <p className="text-xs text-slate-500">{t("noExams")}</p>
                );
              return sorted.map((s) => {
                const total = s.pass + s.fail;
                const rate = pct(s.pass, total);
                return (
                  <div key={s.n}>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700">{t("attemptLabel", { n: s.n })}</span>
                      <span className="text-slate-500">
                        {t("attemptRate", { rate, pass: s.pass, total })}
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
            {t("topOverdue")}
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            {t("topOverdueHelp")}
          </p>
          {topOverdue.length === 0 ? (
            <p className="text-sm text-slate-500">{t("noOverdue")}</p>
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
                        {a.plan.course.title} · {t("dueDate", { date: fmtTrDate(a.dueDate) })}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-red-600 shrink-0">
                      {t("daysLate", { days: daysLate })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{t("detailedExport")}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("detailedExportHelp")}
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
          {t("downloadExcel")}
        </a>
      </div>
    </Shell>
  );
}
