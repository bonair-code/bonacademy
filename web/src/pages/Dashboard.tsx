import { PageHead } from "../components/PageHead";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { useCompliance, type Finding } from "../lib/compliance";
import { coverTone } from "../lib/coverTone";

/**
 * Dashboard rol başına AYRI bir ekran. Tek bir ekranı rollere göre parça parça
 * gizlemek, herkese yanlış bir öncelik dayatıyordu: admin kendi üç atamasını
 * görüyor, öğrenci de anlamadığı kurum istatistiklerini.
 *
 *   ADMIN / MANAGER / INSTRUCTOR → kurum tablosu: tek bir oran, tek bir iş listesi.
 *   USER / CUSTOMER              → kendi eğitim kartları, başka hiçbir şey.
 */
export function Dashboard() {
  const { role } = useAuth();
  const oversees = role === "ADMIN" || role === "MANAGER" || role === "INSTRUCTOR";
  return oversees ? <StaffDashboard /> : <LearnerDashboard />;
}

// ─────────────────────────────────────────────────────────────
// Ortak
// ─────────────────────────────────────────────────────────────

type Assignment = {
  id: string;
  courseId: string;
  courseTitle: string;
  status: string;
  sectionsDone?: string[];
  dueDate?: Timestamp | null;
};

type Course = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  durationHours?: number | null;
  ownerInstructorName?: string | null;
  /** İsteğe bağlı kapak görseli; yoksa başlıktan türetilen desen basılır. */
  coverUrl?: string | null;
};

const DAY = 86400000;
const isDone = (s: string) => s === "COMPLETED" || s === "EXAM_PASSED";

const STATUS: Record<string, string> = {
  PENDING: "Not started",
  IN_PROGRESS: "In progress",
  SECTIONS_DONE: "Ready for exam",
  EXAM_FAILED: "Exam failed",
};

function fmt(ts?: Timestamp | null): string {
  const d = ts?.toDate?.();
  return d ? d.toLocaleDateString("tr-TR") : "—";
}

/** Kendi atamalarını canlı dinler. Herkes için aynı sorgu. */
function useMyAssignments(uid?: string) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, "assignments"), where("userId", "==", uid)),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Assignment, "id">) })));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [uid]);
  return { rows, loading };
}

// ─────────────────────────────────────────────────────────────
// ÖĞRENEN — çalışan ve müşteri
// ─────────────────────────────────────────────────────────────

/**
 * Atanan eğitimler kart olarak. Kart, eğitime girmeden önce merak edilen her
 * şeyi taşır: ne kadarı bitti, konusu ne, kim veriyor, ne zamana kadar.
 */
/**
 * Atama kartları için kurs bilgisi ve bölüm sayısı.
 *
 * Hem öğrenci panosu hem yönetici panosu aynı kartı basıyor: yöneticiye
 * atanan eğitim de tek satırlık bir özet değil, personeldekiyle aynı kart
 * olmalı — kimse kendi eğitimini başka bir dille okumak zorunda kalmasın.
 */
function useAssignmentCards(rows: Assignment[]) {
  const [courses, setCourses] = useState<Record<string, Course>>({});
  /** Kurs başına bölüm sayısı — ilerleme yüzdesi bundan çıkar. */
  const [sectionCount, setSectionCount] = useState<Record<string, number>>({});

  const courseIds = useMemo(
    () => [...new Set(rows.map((r) => r.courseId))].sort().join(","),
    [rows]
  );

  useEffect(() => {
    const ids = courseIds ? courseIds.split(",") : [];
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const found: Record<string, Course> = {};
      const counts: Record<string, number> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const [c, secs] = await Promise.all([
              getDoc(doc(db, "courses", id)),
              getDocs(collection(db, "courses", id, "sections")),
            ]);
            if (c.exists()) found[id] = { id: c.id, ...(c.data() as Omit<Course, "id">) };
            counts[id] = secs.size;
          } catch {
            // Kurs okunamazsa kart yine basılır; yalnızca açıklama/eğitmen boş kalır.
          }
        })
      );
      if (!alive) return;
      setCourses(found);
      setSectionCount(counts);
    })();
    return () => {
      alive = false;
    };
  }, [courseIds]);

  return { courses, sectionCount };
}

function LearnerDashboard() {
  const { profile, role } = useAuth();
  const { rows, loading } = useMyAssignments(profile?.uid);
  const { courses, sectionCount } = useAssignmentCards(rows);

  const now = Date.now();
  const open = useMemo(
    () =>
      rows
        .filter((r) => !isDone(r.status))
        .sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [rows]
  );
  const done = useMemo(() => rows.filter((r) => isDone(r.status)), [rows]);

  return (
    <div>
      <PageHead
        title="My Training"
        subtitle={
          profile?.company
            ? `${profile.name} · ${profile.company}`
            : `Welcome${profile?.name ? `, ${profile.name}` : ""}.`
        }
      />

      {loading ? (
        <div className="card p-8 text-center text-sm text-slate-400">Loading…</div>
      ) : open.length === 0 && done.length === 0 ? (
        <EmptyState
          title="No training assigned yet"
          line={
            role === "CUSTOMER"
              ? "Once BonAir Academy assigns you a course it will appear here."
              : "Nothing is waiting on you right now."
          }
        />
      ) : (
        <>
          {open.length > 0 && (
            <section className="mb-7">
              <SectionTitle title={`Assigned to you (${open.length})`} />
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {open.map((a, i) => (
                  <CourseCard
                    key={a.id}
                    a={a}
                    course={courses[a.courseId]}
                    total={sectionCount[a.courseId] ?? 0}
                    now={now}
                    urgent={i === 0}
                  />
                ))}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <SectionTitle
                title={`Completed (${done.length})`}
                right={
                  <Link
                    to="/certificates"
                    className="text-[12px] font-semibold text-brand-700 hover:underline"
                  >
                    My certificates →
                  </Link>
                }
              />
              <div className="card divide-y divide-slate-100">
                {done.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="h-7 w-7 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
                      <IconCheck />
                    </span>
                    <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 truncate">
                      {a.courseTitle}
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0">Completed</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CourseCard({
  a,
  course,
  total,
  now,
  urgent,
}: {
  a: Assignment;
  course?: Course;
  total: number;
  now: number;
  urgent: boolean;
}) {
  const doneCount = a.sectionsDone?.length ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((doneCount / total) * 100)) : 0;
  const dueMs = a.dueDate?.toMillis?.() ?? null;
  const late = dueMs !== null && dueMs < now;
  const days = dueMs !== null ? Math.round((dueMs - now) / DAY) : null;
  const tone = coverTone(a.courseTitle || course?.title || "");
  const started = a.status !== "PENDING";

  return (
    <div className="card overflow-hidden flex flex-col">
      {/* Kapak. Görsel yüklendiyse o, yoksa kurstan türetilen sabit desen —
          her kursun kapağı her zaman aynı renkte çıkar, tanınır olur. */}
      <div
        className="relative aspect-[16/9] shrink-0 flex items-end"
        style={
          course?.coverUrl
            ? { backgroundImage: `url(${course.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { background: `linear-gradient(140deg, ${tone.from}, ${tone.to})` }
        }
      >
        {!course?.coverUrl && (
          <img
            src="/Logo.png"
            alt=""
            aria-hidden="true"
            className="absolute right-3 top-3 h-4 w-auto opacity-25"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        )}
      </div>

      {/* Başlık kapağın ALTINDA. Görselin üstünde dururken, yüklenen kapak
          zaten yazı içerdiği için iki metin üst üste biniyor ve ikisi de
          okunmuyordu. */}
      <div className="px-3.5 pt-3">
        {course?.category && (
          <span className="block text-[9.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {course.category}
          </span>
        )}
        <div className="text-[13.5px] font-semibold text-slate-900 leading-snug line-clamp-2">
          {a.courseTitle}
        </div>
      </div>

      {/* Durum + ilerleme */}
      <div className="px-3.5 pt-2.5 flex items-center gap-2.5">
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded ${
            a.status === "EXAM_FAILED"
              ? "bg-red-50 text-red-700"
              : started
              ? "bg-amber-50 text-amber-800"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {STATUS[a.status] ?? "Assigned"}
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-slate-500 shrink-0">
          {pct}%
        </span>
      </div>

      <div className="px-3.5 pt-2.5 pb-3 flex-1 flex flex-col">
        {course?.description && (
          <p className="text-[12px] text-slate-600 leading-relaxed line-clamp-3">
            {course.description}
          </p>
        )}

        <div className="mt-2.5 space-y-0.5">
          {course?.ownerInstructorName && (
            <div className="text-[11.5px] text-slate-500">
              Instructor: <span className="text-slate-700">{course.ownerInstructorName}</span>
            </div>
          )}
          {course?.durationHours != null && (
            <div className="text-[11.5px] text-slate-500">Duration: {course.durationHours} hours</div>
          )}
          {dueMs !== null && (
            <div className="text-[11.5px] text-slate-500">
              Due {fmt(a.dueDate)}
              {days !== null && (
                <span
                  className={`ml-1.5 font-semibold tabular-nums ${
                    late ? "text-red-700" : days <= 7 ? "text-amber-700" : "text-slate-400"
                  }`}
                >
                  {late ? `${-days}d overdue` : `${days}d left`}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-auto pt-3.5">
          <Link
            to={`/learn/${a.id}`}
            // Yalnızca en acil olan dikkat çeker; hepsi yanıp sönerse hiçbiri çekmez.
            className={`btn-primary w-full text-xs py-2 ${urgent ? "pulse-cta" : ""}`}
          >
            {started ? "Continue" : "Start Training"}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// YÖNETEN — admin / müdür / eğitmen
// ─────────────────────────────────────────────────────────────

type Tab = "ALL" | Finding["kind"];

/**
 * Tek soru: kurum ne durumda ve bugün kime gidilecek. Üstte tek bir oran ve
 * tek bir cümle; altında tek bir öncelik listesi. Sayaçlar ayrı kutular değil,
 * listenin filtresi — zaten işlevleri buydu.
 */
function StaffDashboard() {
  const { profile, role } = useAuth();
  const c = useCompliance(
    profile ? { uid: profile.uid, departmentId: profile.departmentId } : null,
    role
  );
  const [tab, setTab] = useState<Tab>("ALL");
  const { rows: mineRows } = useMyAssignments(profile?.uid);
  const { courses: myCourses, sectionCount: mySections } = useAssignmentCards(mineRows);
  /** Açık olanlar, son teslimi yakın olan önce. */
  const mine = useMemo(
    () =>
      mineRows
        .filter((r) => !isDone(r.status))
        .sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [mineRows]
  );
  const mineDone = useMemo(() => mineRows.filter((r) => isDone(r.status)), [mineRows]);

  const list = useMemo(
    () => (tab === "ALL" ? c.findings : c.findings.filter((f) => f.kind === tab)),
    [c.findings, tab]
  );

  /**
   * Bir kişide 9 eğitim birden eksikse liste o kişiyle dolar. MISSING kayıtları
   * kişi başına tek satıra indiriliyor, kalanı "+N" olarak yazılıyor.
   */
  const shown = useMemo(() => {
    const out: (Finding & { extra?: number })[] = [];
    const seen = new Map<string, number>();
    for (const f of list) {
      if (f.kind !== "MISSING") {
        out.push(f);
        continue;
      }
      const at = seen.get(f.userId);
      if (at === undefined) {
        seen.set(f.userId, out.length);
        out.push({ ...f });
      } else {
        out[at] = { ...out[at], extra: (out[at].extra ?? 0) + 1 };
      }
    }
    // Hepsi gösterilir; liste kendi içinde kayar. Eskiden ilk 8 gösterilip
    // gerisi "see the full matrix" bağlantısına havale ediliyordu — açığın
    // tamamını görmek için sayfa değiştirmek gerekiyordu.
    return out.sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));
  }, [list]);

  const totalRows = useMemo(() => {
    const missingUsers = new Set(list.filter((f) => f.kind === "MISSING").map((f) => f.userId)).size;
    return list.filter((f) => f.kind !== "MISSING").length + missingUsers;
  }, [list]);

  const pct =
    c.staffTotal > 0 ? Math.round(((c.staffTotal - c.staffAtRisk) / c.staffTotal) * 100) : 100;
  const ringColor = pct >= 90 ? "#30b15a" : pct >= 70 ? "#f0a020" : "#e0332c";

  /** En acil kayıt — başlığın altındaki cümleyi somutlaştırır. */
  const soonest = useMemo(
    () =>
      c.findings
        .filter((f) => f.kind === "SOON" && f.days != null)
        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0] ?? null,
    [c.findings]
  );

  return (
    <div>
      <PageHead
        title="Dashboard"
        subtitle={role === "MANAGER" ? "Your department at a glance." : "The organisation at a glance."}
      />

      {/* Okuma reddedilirse tablo eksik olur; sessiz kalmak yerine söyle. */}
      {c.error && (
        <p className="mb-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Some records could not be read, so these numbers may be incomplete: {c.error}
        </p>
      )}

      {/* ── Tek oran, tek cümle ─────────────────────────────── */}
      <div className="card px-4 sm:px-5 py-5 mb-3 flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        <ComplianceRing pct={pct} color={ringColor} />

        <div className="flex-1 min-w-0 w-full text-center sm:text-left">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-slate-900 leading-snug">
            {c.loading
              ? "Calculating…"
              : c.staffAtRisk === 0
              ? "Every required training is in date"
              : `${c.staffAtRisk} ${c.staffAtRisk === 1 ? "person has" : "people have"} an open training gap`}
          </h2>
          <p className="text-[13px] text-slate-600 mt-1">
            {c.staffTotal - c.staffAtRisk} of {c.staffTotal} staff have nothing outstanding
            {soonest?.days != null ? ` · the next expiry is in ${soonest.days} days` : ""}.
          </p>

          <div className="flex gap-7 mt-3.5">
            <Stat n={c.expired} label="Expired" tone="#e0332c" />
            <Stat n={c.missing} label="Never taken" />
            <Stat n={c.soon} label="Due in 90 days" tone="#f0a020" />
          </div>
        </div>

        <Link to="/follow-up" className="btn-primary text-xs py-2 px-4 shrink-0 no-print">
          Open Follow-Up
        </Link>
      </div>

      {/* ── Tek iş listesi ──────────────────────────────────── */}
      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] font-bold text-slate-900">
            Needs attention <span className="text-slate-400 font-normal">({totalRows})</span>
          </span>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { key: "ALL", label: "All" },
              { key: "EXPIRED", label: "Expired" },
              { key: "MISSING", label: "Never taken" },
              { key: "SOON", label: "90 days" },
            ]}
          />
        </div>

        {c.loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Nothing outstanding here.
          </p>
        ) : (
          // Yükseklik sabit: bölüm kaç kayıt olursa olsun aynı boyda kalır,
          // fazlası içeride kaydırılır.
          <div className="p-2.5 space-y-2 max-h-[520px] overflow-y-auto">
            {shown.map((f) => (
              <FindingRow key={`${f.userId}|${f.courseId}|${f.kind}`} f={f} />
            ))}
          </div>
        )}

      </div>

      {/* ── Kendi eğitimin ──────────────────────────────────────
          Yönetici de personeldir. Eskiden burada yalnızca ilk atamanın tek
          satırlık özeti vardı; kaç eğitim beklediği, hangileri olduğu
          görünmüyordu. Artık personeldekiyle AYNI kart. */}
      <div className="mt-5">
        <SectionTitle
          title={`My Training${mine.length ? ` (${mine.length})` : ""}`}
          right={
            <Link
              to="/certificates"
              className="text-[12px] font-semibold text-brand-700 hover:underline"
            >
              My certificates →
            </Link>
          }
        />
        {mine.length > 0 ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {mine.map((a, i) => (
              <CourseCard
                key={a.id}
                a={a}
                course={myCourses[a.courseId]}
                total={mySections[a.courseId] ?? 0}
                now={Date.now()}
                urgent={i === 0}
              />
            ))}
          </div>
        ) : (
          <div className="card px-5 py-3.5 flex items-center gap-3">
            <span className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
              <IconCheck />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-slate-900">Nothing pending</div>
              <div className="text-[11px] text-slate-500">
                No training is waiting on you.
                {mineDone.length > 0 ? ` ${mineDone.length} completed.` : ""}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ComplianceRing({ pct, color }: { pct: number; color: string }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="112" height="112" viewBox="0 0 120 120" className="shrink-0" aria-hidden="true">
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(0,0,0,.07)" strokeWidth="13" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct / 100)}
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text
        x="60"
        y="58"
        textAnchor="middle"
        fontSize="27"
        fontWeight="700"
        fill="#1d1d1f"
        letterSpacing="-1"
      >
        {pct}%
      </text>
      <text x="60" y="75" textAnchor="middle" fontSize="10.5" fill="#6e6e73">
        compliant
      </text>
    </svg>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div>
      <div
        className="text-[20px] font-bold tabular-nums tracking-[-0.02em] leading-none"
        style={{ color: tone ?? "#1d1d1f" }}
      >
        {n}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex bg-slate-100 rounded-[9px] p-0.5 no-print">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-[7px] transition ${
            value === o.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title, line }: { title: string; line: string }) {
  return (
    <div className="card px-5 py-10 text-center">
      <div className="text-[14px] font-semibold text-slate-900">{title}</div>
      <div className="text-[12px] text-slate-500 mt-1">{line}</div>
    </div>
  );
}

/**
 * "Act on these" satırı. Eski hâlinde kalan gün sağda 11px gri bir metindi
 * ("in 36d") ve listenin en önemli bilgisi olmasına rağmen hiç görünmüyordu.
 * Aciliyet artık üç yerden okunuyor: sol şeridin rengi, kartın zemini ve
 * sağdaki büyük rakam.
 */
function FindingRow({ f }: { f: Finding & { extra?: number } }) {
  const d = f.days;
  const overdue = f.kind === "EXPIRED" || (d !== null && d < 0);

  // Renk aciliyete göre; MISSING'in günü yok, kendi nötr tonunda durur.
  const tone =
    f.kind === "MISSING"
      ? { bar: "#8e8e93", bg: "#f7f7f9", fg: "#57575c", icon: "bg-slate-200 text-slate-600" }
      : overdue
      ? { bar: "#e0332c", bg: "#fdf2f2", fg: "#b3241f", icon: "bg-red-100 text-red-700" }
      : d !== null && d <= 30
      ? { bar: "#ef7a1a", bg: "#fdf6ef", fg: "#a8530c", icon: "bg-orange-100 text-orange-700" }
      : { bar: "#f0a020", bg: "#fdfaf0", fg: "#8a5c08", icon: "bg-amber-100 text-amber-800" };

  return (
    <Link
      to={`/team/${f.userId}`}
      className="flex items-center gap-3 rounded-xl border border-slate-200/70 pl-0 pr-3 py-2.5 hover:shadow-card transition"
      style={{ background: tone.bg, borderLeft: `4px solid ${tone.bar}` }}
    >
      <span
        className={`ml-2.5 h-7 w-7 rounded-lg grid place-items-center shrink-0 ${tone.icon}`}
        aria-hidden="true"
      >
        {f.kind === "MISSING" ? <IconMissing /> : overdue ? <IconAlert /> : <IconClock />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-900 truncate">
          {f.userName}
        </span>
        <span className="block text-[11.5px] text-slate-500 truncate">
          {f.courseTitle}
          {f.extra ? ` + ${f.extra} more` : ""}
        </span>
      </span>

      {/* Kalan gün: rakam büyük, birimi altında küçük — ekranın karşısından
          okunacak tek şey bu. */}
      <span className="shrink-0 text-right leading-none" style={{ color: tone.fg }}>
        {f.kind === "MISSING" ? (
          <span className="text-[12px] font-bold uppercase tracking-[0.04em]">Not taken</span>
        ) : d === null ? (
          <span className="text-[12px] font-bold">—</span>
        ) : d === 0 ? (
          <span className="text-[13px] font-bold uppercase tracking-[0.04em]">Today</span>
        ) : (
          <>
            <span className="block text-[19px] font-bold tabular-nums tracking-[-0.02em]">
              {Math.abs(d)}
            </span>
            <span className="block text-[10px] font-medium mt-0.5 opacity-80">
              {overdue ? "days overdue" : "days left"}
            </span>
          </>
        )}
      </span>

      <span className="shrink-0 text-slate-300 text-[15px] leading-none">›</span>
    </Link>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" strokeLinecap="round" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.3" strokeLinecap="round" />
    </svg>
  );
}
function IconMissing() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
    </svg>
  );
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2.5">
      <h2 className="text-[13px] font-bold text-slate-900">{title}</h2>
      {right}
    </div>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
