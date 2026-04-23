import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import Link from "next/link";
import { formatDate } from "@/lib/format";

type Tone = "teal" | "amber" | "green" | "red" | "slate";

function TileIcon({ tone, d }: { tone: Tone; d: string }) {
  const cls =
    tone === "teal"
      ? "tile-icon tile-teal"
      : tone === "amber"
      ? "tile-icon tile-amber"
      : tone === "green"
      ? "tile-icon tile-green"
      : tone === "red"
      ? "tile-icon tile-red"
      : "tile-icon tile-slate";
  return (
    <div className={`${cls} !h-8 !w-8 !mb-1.5`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d={d} />
      </svg>
    </div>
  );
}

function Kpi({
  tone,
  icon,
  value,
  label,
}: {
  tone: Tone;
  icon: string;
  value: number | string;
  label: string;
}) {
  const numCls =
    tone === "teal"
      ? "text-teal-600"
      : tone === "amber"
      ? "text-amber-500"
      : tone === "green"
      ? "text-emerald-600"
      : tone === "red"
      ? "text-red-500"
      : "text-slate-700";
  return (
    <div className="kpi !p-3">
      <TileIcon tone={tone} d={icon} />
      <div className={`text-2xl font-bold leading-none ${numCls}`}>{value}</div>
      <div className="mt-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-400">
        {label}
      </div>
    </div>
  );
}

const I = {
  clipboard:
    "M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1zM6 7h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
  refresh:
    "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5",
  check:
    "M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  alarm:
    "M12 8v5l3 2M12 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM5 3 2 6M19 3l3 3",
  clock:
    "M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  cert:
    "M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 4-3-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
};

export default async function Dashboard() {
  const user = await requireUser();

  const [active, overdue, completed, inProgress, certs, upcoming] =
    await Promise.all([
      prisma.assignment.count({
        where: { userId: user.id, status: { notIn: ["COMPLETED"] } },
      }),
      prisma.assignment.count({
        where: { userId: user.id, status: "OVERDUE" },
      }),
      prisma.assignment.count({
        where: { userId: user.id, status: "COMPLETED" },
      }),
      prisma.assignment.count({
        where: {
          userId: user.id,
          status: { in: ["IN_PROGRESS", "SCORM_COMPLETED", "EXAM_FAILED", "RETAKE_REQUIRED"] },
        },
      }),
      prisma.certificate.count({ where: { userId: user.id } }),
      prisma.assignment.findMany({
        where: { userId: user.id, status: { notIn: ["COMPLETED"] } },
        include: { plan: { include: { course: true } } },
        orderBy: { dueDate: "asc" },
        take: 6,
      }),
    ]);

  const pending = active - inProgress;

  const recentCerts = await prisma.certificate.findMany({
    where: { userId: user.id },
    include: { assignment: { include: { plan: { include: { course: true } } } } },
    orderBy: { issuedAt: "desc" },
    take: 5,
  });

  const statusLabel: Record<string, { text: string; cls: string }> = {
    PENDING: { text: "Bekliyor", cls: "badge-slate" },
    IN_PROGRESS: { text: "Devam Ediyor", cls: "badge-amber" },
    SCORM_COMPLETED: { text: "Sınav Bekliyor", cls: "badge-teal" },
    EXAM_PASSED: { text: "Sınav Geçti", cls: "badge-green" },
    EXAM_FAILED: { text: "Sınav Başarısız", cls: "badge-red" },
    RETAKE_REQUIRED: { text: "Tekrar Gerekli", cls: "badge-red" },
    COMPLETED: { text: "Tamamlandı", cls: "badge-green" },
    OVERDUE: { text: "Gecikmiş", cls: "badge-red" },
  };

  return (
    <Shell user={user} title="Gösterge Paneli" subtitle="Genel Bakış">
      {/* Section heading with PDF action */}
      <div className="flex items-center justify-between mb-4 mt-2">
        <h2 className="text-lg font-semibold text-slate-900">
          Eğitim Özeti
        </h2>
        <button className="btn-secondary text-xs py-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h6" />
          </svg>
          PDF
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        <Kpi tone="teal"  icon={I.clipboard} value={active}     label="Aktif Eğitim" />
        <Kpi tone="slate" icon={I.calendar}  value={pending < 0 ? 0 : pending} label="Bekleyen" />
        <Kpi tone="amber" icon={I.refresh}   value={inProgress} label="Devam Eden" />
        <Kpi tone="green" icon={I.check}     value={completed}  label="Tamamlanan" />
        <Kpi tone="red"   icon={I.alarm}     value={overdue}    label="Geciken" />
        <Kpi tone="amber" icon={I.clock}     value={certs}      label="Sertifikalarım" />
      </div>

      {/* Active trainings card */}
      <div className="card mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-teal-600">
              <path d={I.clipboard} />
            </svg>
            <h3 className="font-semibold text-slate-900">Aktif Eğitimlerim</h3>
          </div>
          <span className="text-xs text-slate-400">{upcoming.length} kayıt</span>
        </div>
        <div className="divide-y divide-slate-100">
          {upcoming.length === 0 && (
            <p className="p-8 text-center text-slate-400 text-sm">
              Aktif eğitiminiz yok.
            </p>
          )}
          {upcoming.map((a) => {
            const s = statusLabel[a.status] || { text: a.status, cls: "badge-slate" };
            const overdue = new Date(a.dueDate) < new Date();
            // SCORM tamamlanmış (veya tek bir sınav başarısızlığı sonrası
            // tekrar deneyebiliyor) → "Sınava Başla". Aksi halde eğitim sayfasına.
            const examReady =
              a.status === "SCORM_COMPLETED" || a.status === "EXAM_FAILED";
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/70 transition"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="tile-icon tile-teal !mb-0 !h-10 !w-10">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d={I.clipboard} />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {a.plan.course.title}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Döngü {a.cycleNumber} · Son tarih{" "}
                      <span className={overdue ? "text-red-600 font-medium" : ""}>
                        {formatDate(a.dueDate)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={s.cls}>{s.text}</span>
                  {examReady ? (
                    <Link href={`/exam/${a.id}`} className="btn-primary text-xs py-1.5">
                      Sınava Başla →
                    </Link>
                  ) : (
                    <Link
                      href={`/course/${a.id}`}
                      className="btn-secondary text-xs py-1.5"
                    >
                      Eğitime Git →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Certificates (collapsible) */}
      <details className="card group">
        <summary className="flex items-center justify-between px-5 py-4 border-b border-slate-100 cursor-pointer list-none select-none hover:bg-slate-50/60">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-emerald-600">
              <path d={I.cert} />
            </svg>
            <h3 className="font-semibold text-slate-900">Sertifikalarım</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{recentCerts.length} kayıt</span>
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
        <div className="divide-y divide-slate-100">
          {recentCerts.length === 0 && (
            <p className="p-8 text-center text-slate-400 text-sm">
              Henüz sertifikanız yok.
            </p>
          )}
          {recentCerts.map((c) => (
            <a
              key={c.id}
              href={`/api/certificate/${c.id}`}
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/70 transition"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="tile-icon tile-green !mb-0 !h-10 !w-10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d={I.cert} />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {c.assignment.plan.course.title}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Seri No: {c.serialNo}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-500">{formatDate(c.issuedAt)}</span>
            </a>
          ))}
        </div>
      </details>
    </Shell>
  );
}
