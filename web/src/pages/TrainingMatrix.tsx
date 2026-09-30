import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { isStaffRole, useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { PrintButton } from "../components/PrintButton";
import { exclusionFor, requirementFor } from "../lib/requirements";
import { heldMethods, methodBreakdown, methodsOf, worstOf, type MethodRow } from "../lib/methods";
import { Modal } from "../components/Modal";
import { ExternalCertForm } from "../components/ExternalCertForm";

/**
 * Training Follow-Up Form — personel × eğitim matrisi.
 * Excel'deki formun sistemden üretilen hali: her hücrede son alınma tarihi ve
 * kalan gün, 90/60/30 gün eşiklerine göre renklendirilmiş.
 */

type UserRow = {
  id: string;
  name: string;
  departmentId: string | null;
  jobTitleIds?: string[];
  subScopeIds?: string[];
  isActive?: boolean;
  role?: string;
  /** Metod bazlı eğitimlerde kişinin yetkili olduğu metodlar. */
  courseMethods?: Record<string, string[]>;
};
type CourseRow = {
  id: string;
  title: string;
  isActive?: boolean;
  /** Eğitim metodlara bölünüyorsa listesi. */
  methods?: string[];
  recurrenceEvery?: number | null;
  recurrenceUnit?: string;
};
type JobTitle = {
  id: string;
  name: string;
  requiredCourseIds?: string[];
  subScopes?: { id: string; name: string; requiredCourseIds?: string[] }[];
};

type CellState =
  /** Gerekmiyor. `exemptBy` doluysa bir alt yetki bunu düşürmüş demektir. */
  | { kind: "NA"; exemptBy?: string | null }
  | { kind: "PLANNED" }
  | { kind: "MISSING"; methodsMissing?: string[]; methodRows?: MethodRow[] }
  | {
      kind: "DONE";
      date: Date;
      expires: Date | null;
      days: number | null;
      external?: string | null;
      /** İç sertifika id.si — hücreden belgeye gidilebilsin. */
      certificateId?: string | null;
      /** Dış sertifikanın dosya bağlantısı. */
      externalUrl?: string | null;
      /** Detay kartında gösterilenler. */
      serialNo?: string | null;
      instructor?: string | null;
      durationHours?: number | null;
      /** Dış kayıtta belgenin kendi başlığı; kurs adından farklı olabilir. */
      recordTitle?: string | null;
      /** Metod bazlı eğitimde her metodun kendi tarihleri. */
      methodRows?: MethodRow[];
    };

const DAY = 86400000;

/**
 * Isı haritası. Excel'deki bantların karşılığı ama tek bir sürekli ölçek:
 * yeşilden kırmızıya. Eski hâlde yedi lejant etiketi vardı ve ikisi birebir
 * aynı renkti (Missing ile 30-0 gün, Planned ile 90-60 gün) — lejantta ayrı
 * yazan dört şey ekranda iki renkti.
 */
const HEAT = {
  fresh: "#30b15a", // 1 yıldan uzun ya da süresiz
  good: "#7fb845", // 90-365 gün
  warn: "#f0a020", // 90-60
  near: "#ef7a1a", // 60-30
  soon: "#e0332c", // 30-0
  over: "#c0271f", // süresi dolmuş
  missing: "#8e1b16", // hiç alınmamış
  planned: "#f5e6bf",
} as const;

/** Zemin + yazı rengi. Koyu zeminde beyaz yazı, açıkta koyu. */
function heat(state: CellState): { bg: string; fg: string } {
  if (state.kind === "MISSING") return { bg: HEAT.missing, fg: "#fff" };
  if (state.kind === "PLANNED") return { bg: HEAT.planned, fg: "#7a5c0a" };
  if (state.kind === "NA") return { bg: "transparent", fg: "#c7c7cc" };
  const d = state.days;
  if (d === null) return { bg: HEAT.fresh, fg: "#0f2f1a" };
  if (d < 0) return { bg: HEAT.over, fg: "#fff" };
  if (d <= 30) return { bg: HEAT.soon, fg: "#fff" };
  if (d <= 60) return { bg: HEAT.near, fg: "#fff" };
  if (d <= 90) return { bg: HEAT.warn, fg: "#3b2a05" };
  if (d <= 365) return { bg: HEAT.good, fg: "#14300b" };
  return { bg: HEAT.fresh, fg: "#0f2f1a" };
}

function addValidity(base: Date, every?: number | null, unit?: string): Date | null {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

const fmt = (d: Date) => d.toLocaleDateString("tr-TR");

export function TrainingMatrix() {
  const { profile, role } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [departments, setDepartments] = useState<Map<string, string>>(new Map());
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [certs, setCerts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [externals, setExternals] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const onErr = (e: { message: string }) => setErr(e.message);
  const [q, setQ] = useState("");
  const [fDept, setFDept] = useState("");
  const [fScope, setFScope] = useState("");
  const [fCourse, setFCourse] = useState("");
  const [fStatus, setFStatus] = useState("");
  /**
   * Eksik hücreden doğrudan kayıt girme. Eskiden kişi sayfasına gidip oradan
   * eklemek gerekiyordu; matriste eksiği görüp aynı yerde kapatamıyordun.
   */
  const [record, setRecord] = useState<{ user: UserRow; course: CourseRow } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!profile) return;
    // Müdür yalnızca kendi departmanını okuyabilir; kapsamsız sorgu komple
    // reddedilir, o yüzden her koleksiyon role göre daraltılır.
    const seesAll = role === "ADMIN" || role === "INSTRUCTOR";
    const dept = profile.departmentId;
    const scoped = (name: string, field: string) =>
      seesAll
        ? query(collection(db, name))
        : query(collection(db, name), where(field, "==", dept));
    const subs = [
      onSnapshot(
        scoped("users", "departmentId"),
        (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        onErr
      ),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepartments(new Map(s.docs.map((d) => [d.id, (d.data() as any).name])))
      ),
      onSnapshot(collection(db, "jobTitles"), (s) =>
        setJobTitles(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(
        scoped("certificates", "userDepartmentId"),
        (s) => setCerts(s.docs.map((d) => ({ __id: d.id, ...(d.data() as any) }))),
        onErr
      ),
      onSnapshot(
        scoped("assignments", "userDepartmentId"),
        (s) => setAssignments(s.docs.map((d) => d.data())),
        onErr
      ),
      onSnapshot(
        scoped("externalTrainings", "userDepartmentId"),
        (s) => setExternals(s.docs.map((d) => d.data())),
        () => {}
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [profile, role]);

  // Zorunlu kurs kümesi kişinin authorisation scope'larından gelir; her
  // kapsamın gerekli eğitimi ayarlarda tanımlı. Kapsamı olmayanda N/A kalır.
  const isRequired = useMemo(
    () => (u: UserRow, c: CourseRow) =>
      !!requirementFor(c, u.jobTitleIds ?? [], jobTitles, u.subScopeIds ?? []),
    [jobTitles]
  );

  // (userId, courseId) → en son tamamlama. İç sertifika ve dış eğitim birlikte.
  const completions = useMemo(() => {
    type Done = {
      date: Date;
      external?: string | null;
      /** Dış belgenin kendi bitiş tarihi — iç sertifikada yok. */
      expiresAt?: Date | null;
      certId?: string | null;
      url?: string | null;
      serialNo?: string | null;
      instructor?: string | null;
      durationHours?: number | null;
      recordTitle?: string | null;
    };
    const m = new Map<string, Done>();
    const put = (uid: string, cid: string, d: Done | null) => {
      if (!uid || !cid || !d) return;
      const k = `${uid}|${cid}`;
      const prev = m.get(k);
      if (!prev || d.date > prev.date) m.set(k, d);
    };
    for (const c of certs) {
      const date = (c.issuedAt as Timestamp)?.toDate?.();
      if (date)
        put(c.userId, c.courseId, {
          date,
          external: null,
          certId: c.__id,
          serialNo: c.serialNo ?? null,
          instructor: c.instructorName ?? null,
          durationHours: c.durationHours ?? null,
        });
    }
    for (const e of externals) {
      const date = (e.completedAt as Timestamp)?.toDate?.();
      if (date)
        put(e.userId, e.courseId, {
          date,
          external: e.provider ?? "External",
          expiresAt: (e.expiresAt as Timestamp)?.toDate?.() ?? null,
          url: e.fileUrl ?? null,
          serialNo: e.externalSerialNo ?? null,
          durationHours: e.durationHours ?? null,
          recordTitle: e.title ?? null,
        });
    }
    return m;
  }, [certs, externals]);

  /**
   * (userId, courseId) → o kursun BÜTÜN dış kayıtları. Metod bazlı eğitimde
   * kişinin her metodu ayrı bir kayıt; `completions` yalnızca en sonu
   * tuttuğu için burada tamamı gerekiyor.
   */
  const methodRecords = useMemo(() => {
    const m = new Map<string, { method?: string | null; date: Date; expiry: Date | null }[]>();
    for (const e of externals) {
      const date = (e.completedAt as Timestamp)?.toDate?.();
      if (!date || !e.userId || !e.courseId) continue;
      const k = `${e.userId}|${e.courseId}`;
      m.set(k, [
        ...(m.get(k) ?? []),
        {
          method: e.method ?? null,
          date,
          expiry: (e.expiresAt as Timestamp)?.toDate?.() ?? null,
        },
      ]);
    }
    return m;
  }, [externals]);

  const assignedSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of assignments) {
      if (a.status !== "COMPLETED" && a.status !== "EXAM_PASSED")
        s.add(`${a.userId}|${a.courseId}`);
    }
    return s;
  }, [assignments]);

  const hover = useCellHover();

  /**
   * Dış eğitim kaydını admin herkese, müdür yalnızca kendi departmanındaki
   * personele yazabilir — Firestore kuralı da tam olarak bu. Eğitmen matrisi
   * görebiliyor ama kayıt giremiyor, o yüzden ona düğme gösterilmiyor.
   */
  const canRecordFor = (u: UserRow) =>
    role === "ADMIN" || (role === "MANAGER" && u.departmentId === profile?.departmentId);

  function cellFor(u: UserRow, c: CourseRow): CellState {
    /**
     * Metod bazlı eğitim (ör. NDT): kişinin tikli her metodu ayrı takip
     * edilir ve EN KÖTÜSÜ hücreyi belirler. Eskiden yalnızca en son kayıt
     * dikkate alınıyordu; PT geçerli, MT dolmuş bir kişi uyumlu görünüyordu.
     */
    const ticked = heldMethods(u, c.id);
    if (methodsOf(c).length > 0 && ticked.length > 0) {
      const rows = methodBreakdown(ticked, methodRecords.get(`${u.id}|${c.id}`) ?? []);
      const { missing, date, expiry } = worstOf(rows);
      if (missing.length > 0) return { kind: "MISSING", methodsMissing: missing, methodRows: rows };
      return {
        kind: "DONE",
        date: date!,
        expires: expiry,
        days: expiry ? Math.round((expiry.getTime() - Date.now()) / DAY) : null,
        external: "External",
        methodRows: rows,
      };
    }

    const done = completions.get(`${u.id}|${c.id}`);
    if (done) {
      // Dış belgenin geçerliliği kursun tekrar süresinden değil, belgenin
      // kendi bitiş tarihinden gelir — kişi sayfası ve Dashboard böyle
      // hesaplıyordu, matris hesaplamıyordu; üç ekran farklı sonuç veriyordu.
      const expires = done.external
        ? done.expiresAt ?? null
        : addValidity(done.date, c.recurrenceEvery, c.recurrenceUnit);
      return {
        kind: "DONE",
        date: done.date,
        expires,
        days: expires ? Math.round((expires.getTime() - Date.now()) / DAY) : null,
        external: done.external,
        certificateId: done.certId ?? null,
        externalUrl: done.url ?? null,
        serialNo: done.serialNo ?? null,
        instructor: done.instructor ?? null,
        durationHours: done.durationHours ?? null,
        recordTitle: done.recordTitle ?? null,
      };
    }
    if (assignedSet.has(`${u.id}|${c.id}`)) return { kind: "PLANNED" };
    if (isRequired(u, c)) return { kind: "MISSING" };
    return {
      kind: "NA",
      exemptBy: exclusionFor(c, u.jobTitleIds ?? [], jobTitles, u.subScopeIds ?? []),
    };
  }

  // Departmana göre grupla — Excel'deki bölüm başlıkları gibi.
  const groups = useMemo(() => {
    // Müşteri personel değil — takip matrisinde satırı olmaz.
    const active = users.filter((u) => u.isActive !== false && isStaffRole(u.role));
    const m = new Map<string, UserRow[]>();
    for (const u of active) {
      const key = u.departmentId ?? "—";
      m.set(key, [...(m.get(key) ?? []), u]);
    }
    return [...m.entries()]
      .map(([deptId, list]) => ({
        deptId,
        name: departments.get(deptId) ?? "No department",
        list: list.sort((a, b) => a.name.localeCompare(b.name, "tr")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [users, departments]);

  // ---- Filtreler ----
  // Denetimde soru hep aynı: "şu departmanda, şu yetkide, şu eğitimi eksik
  // olan kim?" Filtreler bu soruyu tek ekranda cevaplasın diye.
  const norm = (s: string) => s.toLocaleLowerCase("tr");
  const visibleCourses = useMemo(
    () => (fCourse ? courses.filter((c) => c.id === fCourse) : courses),
    [courses, fCourse]
  );

  const matchesStatus = (u: UserRow) => {
    if (!fStatus) return true;
    return visibleCourses.some((c) => {
      const st = cellFor(u, c);
      if (fStatus === "MISSING") return st.kind === "MISSING";
      if (fStatus === "PLANNED") return st.kind === "PLANNED";
      if (fStatus === "EXPIRED") return st.kind === "DONE" && st.days !== null && st.days < 0;
      if (fStatus === "SOON")
        return st.kind === "DONE" && st.days !== null && st.days >= 0 && st.days <= 90;
      if (fStatus === "DONE") return st.kind === "DONE";
      return true;
    });
  };

  const filteredGroups = useMemo(
    () =>
      groups
        .filter((g) => !fDept || g.deptId === fDept)
        .map((g) => ({
          ...g,
          list: g.list.filter(
            (u) =>
              (!q.trim() || norm(u.name).includes(norm(q.trim()))) &&
              (!fScope || (u.jobTitleIds ?? []).includes(fScope)) &&
              matchesStatus(u)
          ),
        }))
        .filter((g) => g.list.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, q, fDept, fScope, fStatus, visibleCourses, completions, assignedSet, jobTitles]
  );

  const shownStaff = filteredGroups.reduce((n, g) => n + g.list.length, 0);
  const filtersOn = !!(q.trim() || fDept || fScope || fCourse || fStatus);

  if (role !== "ADMIN" && role !== "MANAGER" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  return (
    <div>
      <PageHead
        title="Training Follow-Up"
        subtitle="Personnel × training matrix. Click a name for that person's full record."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search personnel…"
          className="input !w-52 !py-1.5 !text-xs"
        />
        <select
          value={fDept}
          onChange={(e) => setFDept(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs"
        >
          <option value="">All departments</option>
          {[...departments.entries()].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={fScope}
          onChange={(e) => setFScope(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs"
        >
          <option value="">All authorisation scopes</option>
          {jobTitles.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <select
          value={fCourse}
          onChange={(e) => setFCourse(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs"
        >
          <option value="">All trainings</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs"
        >
          <option value="">Any status</option>
          <option value="MISSING">Has missing</option>
          <option value="EXPIRED">Has expired</option>
          <option value="SOON">Expiring within 90 days</option>
          <option value="PLANNED">Has planned</option>
          <option value="DONE">Has completed</option>
        </select>
        {filtersOn && (
          <button
            onClick={() => {
              setQ("");
              setFDept("");
              setFScope("");
              setFCourse("");
              setFStatus("");
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] font-semibold text-slate-700">
            {visibleCourses.length} training{visibleCourses.length === 1 ? "" : "s"} · {shownStaff}{" "}
            {filtersOn ? `of ${groups.reduce((n, g) => n + g.list.length, 0)} ` : ""}staff
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <PrintButton landscape />
          <Swatch color={HEAT.fresh} label="1 yr+" />
          <Swatch color={HEAT.good} label="90–365" />
          <Swatch color={HEAT.warn} label="90–60" />
          <Swatch color={HEAT.near} label="60–30" />
          <Swatch color={HEAT.soon} label="30–0" />
          <Swatch color={HEAT.over} label="Expired" />
          <Swatch color={HEAT.missing} label="Never taken" />
          <Swatch color={HEAT.planned} label="Planned" />
        </div>
      </div>

      <div className="card">
        <div className="overflow-auto max-h-[70vh]">
          <table className="matrix-table text-[12px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-slate-100 text-slate-600 text-left font-semibold px-3 py-2 border-b border-r border-slate-200 min-w-[200px]">
                  Personnel
                </th>
                {visibleCourses.map((c) => (
                  <th
                    key={c.id}
                    className="sticky top-0 z-20 bg-slate-100 text-slate-600 font-semibold px-2 py-2 border-b border-r border-slate-200 align-bottom"
                    // Isı haritasında hücre yalnızca bir sayı taşıyor; sütun
                    // daraldıkça 17 eğitim tek ekrana sığıyor, yatay kaydırma
                    // ihtiyacı kalkıyor.
                    style={{ minWidth: 56, maxWidth: 110 }}
                    title={c.title}
                  >
                    <div className="leading-tight whitespace-normal">{c.title}</div>
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                      {c.recurrenceUnit && c.recurrenceUnit !== "NONE"
                        ? `every ${c.recurrenceEvery} ${c.recurrenceUnit.toLowerCase()}(s)`
                        : "one time"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => (
                <>
                  <tr key={g.deptId}>
                    <td
                      colSpan={visibleCourses.length + 1}
                      className="sticky left-0 bg-brand-50 text-brand-800 font-bold text-[11px] uppercase tracking-wide px-3 py-1.5 border-b border-slate-200"
                    >
                      {g.name}
                    </td>
                  </tr>
                  {g.list.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      {/* İsme tıklayınca kişinin tam kaydı — eksikler, dış
                          sertifikalar, yetkiler ve kişi bazlı PDF. */}
                      <td className="sticky left-0 z-10 bg-white hover:bg-slate-50 font-semibold px-3 py-1.5 border-b border-r border-slate-200 whitespace-nowrap">
                        <Link
                          to={`/team/${u.id}`}
                          className="text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {u.name}
                        </Link>
                      </td>
                      {visibleCourses.map((c) => {
                        const st = cellFor(u, c);
                        const h = heat(st);
                        return (
                          <td
                            key={c.id}
                            className={`border border-white text-center align-middle text-[11px] font-semibold p-0 h-[26px] ${
                              st.kind === "MISSING" ? "cell-missing" : ""
                            } ${st.kind === "NA" ? "matrix-na" : ""}`}
                            style={{ background: h.bg, color: h.fg }}
                            onMouseEnter={(e) => hover.enter(e.currentTarget, u, c, st)}
                            onMouseLeave={hover.leave}
                          >
                            {/* Eksik hücre doğrudan kayıt formunu açar.
                                Dış kaydı yalnızca admin ve kendi departmanının
                                müdürü yazabilir (Firestore kuralı da böyle). */}
                            {/* Eksik hücreden kayıt girilir. Metod bazlı
                                eğitimde dolu hücreden de girilir — ikinci bir
                                metod her zaman eklenebilmeli. */}
                            {canRecordFor(u) &&
                            (st.kind === "MISSING" ||
                              (methodsOf(c).length > 0 && st.kind !== "NA")) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  hover.leave();
                                  setRecord({ user: u, course: c });
                                }}
                                className="group w-full h-full font-semibold"
                              >
                                <span className="group-hover:hidden">
                                  <Cell state={st} />
                                </span>
                                <span className="hidden group-hover:inline">+ add</span>
                              </button>
                            ) : (
                              <Cell state={st} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
              {filteredGroups.length === 0 && (
                <tr>
                  <td colSpan={visibleCourses.length + 1} className="p-8 text-center text-slate-400">
                    No staff yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {err && <p className="px-5 py-3 text-xs text-brand-700 border-t border-slate-100">{err}</p>}
      </div>

      {hover.at && (
        <CellDetail at={hover.at} onEnter={hover.holdOpen} onLeave={hover.closeNow} />
      )}

      {record && (
        <Modal
          title="Record External Training"
          subtitle={`${record.user.name} · ${record.course.title}`}
          onClose={() => setRecord(null)}
        >
          <ExternalCertForm
            user={{
              id: record.user.id,
              name: record.user.name,
              departmentId: record.user.departmentId,
            }}
            course={record.course}
            courses={courses}
            onDone={(m) => {
              setToast(m);
              setRecord(null);
            }}
            onCancel={() => setRecord(null)}
          />
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl no-print">
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Hücrede oyalanınca açılan detay kartı.
 *
 * Hücreye yalnızca kalan gün sığıyor; tarih, bitiş, sertifika numarası ve
 * eğitmen buradan görünür. Tarayıcının kendi `title` ipucu bunları tek satırda
 * ve biçimsiz veriyordu, üstelik gecikmesi ayarlanamıyor.
 */
const HOVER_DELAY_MS = 1000;

type HoverState = {
  user: UserRow;
  course: CourseRow;
  state: CellState;
  rect: DOMRect;
};

function useCellHover() {
  const [at, setAt] = useState<HoverState | null>(null);
  const timer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const enter = (el: HTMLElement, user: UserRow, course: CourseRow, state: CellState) => {
    clear();
    holdOpen();
    // Gerekli olmayan hücrede yalnızca muafiyet varsa gösterilecek bir şey var.
    if (state.kind === "NA" && !state.exemptBy) return;
    const rect = el.getBoundingClientRect();
    timer.current = window.setTimeout(
      () => setAt({ user, course, state, rect }),
      HOVER_DELAY_MS
    );
  };

  /**
   * Hücreden çıkınca kart hemen kapanmaz: hücre ile kart arasında birkaç
   * piksellik boşluk var ve fare oradan geçerken kart kayboluyordu, yani
   * içindeki metni okumak ya da seçmek imkânsızdı. Kısa bir süre beklenir;
   * kartın üstüne girilirse bekleme iptal edilir.
   */
  const leave = () => {
    clear();
    closeTimer.current = window.setTimeout(() => setAt(null), 220);
  };

  /** Kartın üstüne gelindi — kapanmayı iptal et. */
  const holdOpen = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  /** Karttan çıkıldı — kapat. */
  const closeNow = () => {
    clear();
    holdOpen();
    setAt(null);
  };

  // Kaydırma sırasında kart yerinde kalıp yanlış hücreyi işaret ediyordu.
  useEffect(() => {
    if (!at) return;
    const off = () => setAt(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [at]);

  useEffect(() => clear, []);

  return { at, enter, leave, holdOpen, closeNow };
}

function CellDetail({
  at,
  onEnter,
  onLeave,
}: {
  at: HoverState;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { user, course, state, rect } = at;
  const W = 260;
  // Ekranın sağına taşarsa sola, altına taşarsa üstüne açılır.
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 8);
  const below = rect.bottom + 8;
  const openUp = below + 190 > window.innerHeight;

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 justify-between py-[3px]">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="text-slate-800 font-medium text-right min-w-0 break-words">{v}</span>
    </div>
  );

  return createPortal(
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="fixed z-[80] rounded-xl bg-white shadow-xl border border-slate-200 px-3.5 py-3 text-[11.5px] no-print"
      style={{
        width: W,
        left,
        top: openUp ? undefined : below,
        bottom: openUp ? window.innerHeight - rect.top + 8 : undefined,
      }}
      role="tooltip"
    >
      <div className="text-[12.5px] font-semibold text-slate-900 leading-snug">{user.name}</div>
      <div className="text-[11px] text-slate-500 leading-snug mb-2">{course.title}</div>

      {state.kind === "NA" && state.exemptBy && (
        <p className="text-[11.5px] text-slate-600">
          Not required — <b className="text-slate-800">{state.exemptBy}</b> drops this training
          from the scope.
        </p>
      )}

      {/* Metod bazlı eğitimde her metodun kendi tarihi ayrı gösterilir;
          tek bir "en kötü" değer neyin eksik olduğunu söylemiyor. */}
      {state.kind !== "NA" && state.kind !== "PLANNED" && state.methodRows?.length ? (
        <div className="border-t border-slate-100 pt-1.5">
          {state.methodRows.map((r) => (
            <div key={r.method} className="flex gap-3 justify-between py-[3px]">
              <span className="text-slate-500 shrink-0 font-medium">{r.method}</span>
              <span
                className={`text-right min-w-0 ${
                  !r.date
                    ? "text-red-700 font-semibold"
                    : r.expiry && r.expiry.getTime() < Date.now()
                    ? "text-red-700 font-medium"
                    : "text-slate-800 font-medium"
                }`}
              >
                {!r.date
                  ? "no certificate"
                  : r.expiry
                  ? `${fmt(r.date)} → ${fmt(r.expiry)}`
                  : `${fmt(r.date)} · no expiry`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {state.kind === "MISSING" && !state.methodsMissing?.length && (
        <>
          <p className="text-[11.5px] text-red-700 font-semibold">
            Never taken — required by this person's authorisation scope.
          </p>
          <p className="text-[10.5px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100">
            Click the cell to record training taken elsewhere.
          </p>
        </>
      )}
      {state.kind === "PLANNED" && (
        <p className="text-[11.5px] text-amber-800 font-semibold">
          Assigned but not completed yet.
        </p>
      )}

      {state.kind === "DONE" && (
        <div className="border-t border-slate-100 pt-1.5">
          {state.recordTitle && state.recordTitle !== course.title
            ? row("Record", state.recordTitle)
            : null}
          {row("Completed", fmt(state.date))}
          {row(
            "Valid until",
            state.expires ? (
              <>
                {fmt(state.expires)}{" "}
                <span
                  className={
                    state.days !== null && state.days < 0
                      ? "text-red-700"
                      : state.days !== null && state.days <= 90
                      ? "text-amber-700"
                      : "text-slate-400"
                  }
                >
                  (
                  {state.days === null
                    ? "—"
                    : state.days < 0
                    ? `${-state.days}d overdue`
                    : `${state.days}d left`}
                  )
                </span>
              </>
            ) : (
              "No expiry"
            )
          )}
          {state.serialNo ? row("Certificate No", state.serialNo) : null}
          {state.durationHours != null ? row("Duration", `${state.durationHours} hours`) : null}
          {state.instructor ? row("Instructor", state.instructor) : null}
          {row("Source", state.external ? `External — ${state.external}` : "BonAcademy")}

          {(state.certificateId || state.externalUrl) && (
            <div className="mt-2 pt-2 border-t border-slate-100 text-[10.5px] text-slate-400">
              Click the cell to open the certificate.
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-500">
      <i
        className="inline-block h-2.5 w-2.5 rounded-[3px] shrink-0"
        style={{ background: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * Hücre içeriği. Zemin rengi <td> üzerinde; burada yalnızca metin var.
 * Tamamlanmış hücre belgesine bağlıdır — iç sertifika sistemdeki sertifika
 * sayfasına, dış sertifika yüklenen dosyaya gider.
 */
function Cell({ state }: { state: CellState }) {
  // "N/A" açıkça yazılır: nokta, hücrenin boş kaldığı mı yoksa gerekli
  // olmadığı mı belirsiz bırakıyordu.
  if (state.kind === "NA")
    return (
      <span className={`text-[10px] ${state.exemptBy ? "opacity-80 underline decoration-dotted" : "opacity-55"}`}>
        N/A
      </span>
    );
  if (state.kind === "PLANNED") return <span className="font-bold">PLAN</span>;
  if (state.kind === "MISSING")
    return (
      <span className="font-bold">
        {state.methodsMissing?.length ? state.methodsMissing.join(" ") : "—"}
      </span>
    );

  /**
   * Hücre dar: yalnızca kalan gün sığıyor. Tarih, bitiş, sertifika numarası ve
   * eğitmen hücrede oyalanınca açılan detay kartında.
   */
  const body = (
    <span>{state.days === null ? "∞" : state.days < 0 ? `−${-state.days}` : state.days}</span>
  );
  // Tarayıcının siyah ipucu kullanılmıyor: detay kartı aynı bilgiyi daha
  // okunur veriyor ve ikisi üst üste binince hücre okunmaz hâle geliyordu.

  if (state.certificateId) {
    return (
      <Link
        to={`/certificate/${state.certificateId}`}
        className="block tabular-nums hover:underline"
      >
        {body}
      </Link>
    );
  }
  if (state.externalUrl) {
    return (
      <a
        href={state.externalUrl}
        target="_blank"
        rel="noreferrer"
        className="block tabular-nums hover:underline"
      >
        {body}
      </a>
    );
  }
  return (
    <span className="block tabular-nums">
      {body}
    </span>
  );
}
