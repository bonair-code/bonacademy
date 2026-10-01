import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { isStaffRole, useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { PrintButton } from "../components/PrintButton";
import { exclusionFor, requirementFor } from "../lib/requirements";
import {
  heldMethods,
  methodBreakdown,
  methodsOf,
  worstOf,
  type MethodRecord,
  type MethodRow,
} from "../lib/methods";
import { Modal } from "../components/Modal";
import { ExternalCertForm } from "../components/ExternalCertForm";
import { FilePreview } from "../components/FilePreview";
import {
  isAssignmentDone,
  daysLeft,
  expiryOf,
  fmt,
  keyOf,
  methodRecordIndex,
  openAssignmentSet,
  pickLatest,
} from "../lib/records";
import { AnchoredCard } from "../components/AnchoredCard";
import { AssignOne } from "../components/AssignOne";

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
  delivery?: string;
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
      /** Dış kaydın doküman id.si — düzenleme için. */
      externalId?: string | null;
      /** Detay kartında gösterilenler. */
      serialNo?: string | null;
      instructor?: string | null;
      durationHours?: number | null;
      /** Dış kayıtta belgenin kendi başlığı; kurs adından farklı olabilir. */
      recordTitle?: string | null;
      /** Metod bazlı eğitimde her metodun kendi tarihleri. */
      methodRows?: MethodRow[];
    };


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
  /**
   * Eksik hücreye tıklayınca açılan eylem menüsü. Tıklama eskiden doğrudan
   * kayıt formunu açıyordu; artık iki yol var (kayıt gir / eğitim ata), o
   * yüzden arada bir seçim gerekiyor.
   */
  const [menu, setMenu] = useState<HoverState | null>(null);
  /** Tek hücreden atama. */
  const [assign, setAssign] = useState<{ user: UserRow; course: CourseRow } | null>(null);
  /** Bir kişinin bütün eksiklerini birden atama. */
  const [bulk, setBulk] = useState<{ user: UserRow; courses: CourseRow[] } | null>(null);
  /** Düzenlenecek dış kaydın id.si — detay kartındaki "Edit record" açar. */
  const [editId, setEditId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
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
        (s) => setExternals(s.docs.map((d) => ({ __id: d.id, ...(d.data() as any) }))),
        // Sessizce yutulursa dış kayıtlar boş kalır ve matris "hepsi eksik"
        // gösterir — yanlış olduğunu söylemeden. Hata görünür olmalı.
        onErr
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
      extId?: string | null;
      serialNo?: string | null;
      instructor?: string | null;
      durationHours?: number | null;
      recordTitle?: string | null;
    };
    const m = new Map<string, Done>();
    // Kazanan kayıt kuralı lib/records.ts'de: EN SON tamamlanan.
    const put = (uid: string, cid: string, d: Done | null) => {
      if (!uid || !cid || !d) return;
      pickLatest(m, keyOf(uid, cid), d);
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
          extId: e.__id ?? null,
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
  const methodRecords = useMemo(
    () => methodRecordIndex(externals) as Map<string, MethodRecord[]>,
    [externals]
  );

  const assignedSet = useMemo(() => openAssignmentSet(assignments), [assignments]);

  /**
   * (kişi|kurs) → açık atamanın kendisi. Geçerli kaydı olan birine eğitim
   * atandığında hücre tarihi göstermeye devam ediyor (doğrusu bu: kayıt hâlâ
   * geçerli), ama atamanın varlığı hiçbir yerde görünmüyordu.
   */
  const openAssignments = useMemo(() => {
    const m = new Map<string, AssignmentRow>();
    for (const a of assignments) {
      if (isAssignmentDone(a.status)) continue;
      if (a.userId && a.courseId) m.set(keyOf(a.userId, a.courseId), a);
    }
    return m;
  }, [assignments]);

  const hover = useCellHover();

  /** Düzenlenecek dış kayıt — id.den bulunur. */
  const editRow = useMemo(
    () => {
      const e = editId ? (externals.find((x) => x.__id === editId) as any) : null;
      // Form dokümanı `id` ile güncelliyor; listede alan adı `__id`.
      return e ? { ...e, id: e.__id } : null;
    },
    [editId, externals]
  );

  /**
   * Dış eğitim kaydını admin herkese, müdür yalnızca kendi departmanındaki
   * personele yazabilir — Firestore kuralı da tam olarak bu. Eğitmen matrisi
   * görebiliyor ama kayıt giremiyor, o yüzden ona düğme gösterilmiyor.
   */
  const canRecordFor = (u: UserRow) =>
    role === "ADMIN" || (role === "MANAGER" && u.departmentId === profile?.departmentId);

  /**
   * Eğitim ATAMAK kayıt girmekten ayrı bir yetki: eğitimi veren atar. Müdür
   * personelinin durumunu görür ve dışarıdan alınmış eğitimi kaydeder, ama
   * sistemde eğitim atamaz. Sunucu da aynı kuralı uyguluyor.
   */
  const canAssign = role === "ADMIN" || role === "INSTRUCTOR";

  /**
   * Atanabilir eğitim: dışarıdan alınan eğitim sistemde tamamlanamaz, yayında
   * olmayanın da içeriği yok. İkisi de sunucuda reddediliyor; düğmeyi hiç
   * göstermemek daha dürüst.
   */
  const canAssignCourse = (c: CourseRow) =>
    c.delivery !== "EXTERNAL_ONLY" && c.isActive !== false;

  function cellFor(u: UserRow, c: CourseRow): CellState {
    /**
     * Metod bazlı eğitim (ör. NDT): kişinin tikli her metodu ayrı takip
     * edilir ve EN KÖTÜSÜ hücreyi belirler. Eskiden yalnızca en son kayıt
     * dikkate alınıyordu; PT geçerli, MT dolmuş bir kişi uyumlu görünüyordu.
     */
    const ticked = heldMethods(u, c.id);
    if (methodsOf(c).length > 0 && ticked.length > 0) {
      const rows = methodBreakdown(ticked, methodRecords.get(keyOf(u.id, c.id)) ?? []);
      const { missing, date, expiry } = worstOf(rows);
      if (missing.length > 0) return { kind: "MISSING", methodsMissing: missing, methodRows: rows };
      return {
        kind: "DONE",
        date: date!,
        expires: expiry,
        days: daysLeft(expiry),
        external: "External",
        methodRows: rows,
      };
    }

    const done = completions.get(keyOf(u.id, c.id));
    if (done) {
      // Dış belgenin geçerliliği kursun tekrar süresinden değil, belgenin
      // kendi bitiş tarihinden gelir. Kural lib/records.ts'de — matris bunu
      // hesaplamıyordu ve üç ekran aynı kişi için farklı sonuç veriyordu.
      const expires = expiryOf(
        { date: done.date, external: !!done.external, externalExpiry: done.expiresAt ?? null },
        c
      );
      return {
        kind: "DONE",
        date: done.date,
        expires,
        days: daysLeft(expires),
        external: done.external,
        certificateId: done.certId ?? null,
        externalUrl: done.url ?? null,
        externalId: done.extId ?? null,
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
          className="input !w-full sm:!w-52 !py-1.5 !text-xs"
        />
        <select
          value={fDept}
          onChange={(e) => setFDept(e.target.value)}
          className="input !w-full sm:!w-auto !py-1.5 !text-xs"
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
          className="input !w-full sm:!w-auto !py-1.5 !text-xs"
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
          className="input !w-full sm:!w-auto !py-1.5 !text-xs"
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
          className="input !w-full sm:!w-auto !py-1.5 !text-xs"
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

      {/* Telefon görünümü: 200px donmuş ilk kolon + ders başına bir kolon
          375px'e sığmıyor. Aynı `cellFor` hesabı, kişi kartı olarak. */}
      <div className="lg:hidden space-y-2">
        {filteredGroups.map((g) => (
          <div key={g.deptId}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-800 bg-brand-50 rounded-lg px-3 py-1.5 mb-2">
              {g.name}
            </div>
            {g.list.map((u) => {
              const cells = visibleCourses
                .map((c) => ({ c, st: cellFor(u, c) }))
                .filter((x) => x.st.kind !== "NA");
              const missingCount = cells.filter((x) => x.st.kind === "MISSING").length;
              return (
                <div key={u.id} className="card p-3 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Link
                      to={`/team/${u.id}`}
                      className="font-semibold text-[13px] text-slate-900 min-w-0 truncate hover:underline"
                    >
                      {u.name}
                    </Link>
                    {missingCount > 0 && (
                      <span className="ml-auto shrink-0 text-[10px] font-bold text-white bg-brand-600 rounded px-1.5 py-0.5">
                        {missingCount} missing
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cells.length === 0 && (
                      <span className="text-[11.5px] text-slate-400">
                        No training required for this scope.
                      </span>
                    )}
                    {cells.map(({ c, st }) => {
                      const h = heat(st);
                      const tappable =
                        canRecordFor(u) &&
                        (st.kind === "MISSING" || (methodsOf(c).length > 0 && st.kind !== "NA"));
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!tappable}
                          onClick={(e) =>
                            setMenu({
                              user: u,
                              course: c,
                              state: st,
                              rect: e.currentTarget.getBoundingClientRect(),
                            })
                          }
                          className="rounded-md px-2 py-1.5 text-[11px] font-semibold text-left max-w-full disabled:cursor-default"
                          style={{ background: h.bg, color: h.fg }}
                          title={c.title}
                        >
                          <span className="block truncate max-w-[150px]">{c.title}</span>
                          <span className="block text-[10px] opacity-80">
                            {st.kind === "MISSING"
                              ? st.methodsMissing?.length
                                ? st.methodsMissing.join(" ")
                                : "never taken"
                              : st.kind === "PLANNED"
                              ? "planned"
                              : st.kind !== "DONE"
                              ? "—"
                              : st.days === null
                              ? "no expiry"
                              : st.days < 0
                              ? `${-st.days}d overdue`
                              : `${st.days}d left`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <p className="card p-8 text-center text-slate-400 text-sm">No staff yet.</p>
        )}
        {err && <p className="text-xs text-brand-700">{err}</p>}
      </div>

      <div className="card hidden lg:block">
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
                        <span className="group/row flex items-center gap-1.5">
                          <Link
                            to={`/team/${u.id}`}
                            className="text-slate-900 hover:text-brand-700 hover:underline min-w-0 truncate"
                          >
                            {u.name}
                          </Link>
                          {/* Eksiği olan kişide tek tek hücre gezmek yerine
                              hepsini bir kerede atama kısayolu. */}
                          {(() => {
                            if (!canAssign) return null;
                            const missing = visibleCourses.filter(
                              (c) => cellFor(u, c).kind === "MISSING" && canAssignCourse(c)
                            );
                            if (missing.length === 0) return null;
                            return (
                              <button
                                type="button"
                                title={`Assign ${missing.length} missing training${
                                  missing.length === 1 ? "" : "s"
                                }`}
                                onClick={() => setBulk({ user: u, courses: missing })}
                                className="ml-auto shrink-0 opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded px-1.5 py-0.5 no-print"
                              >
                                +{missing.length}
                              </button>
                            );
                          })()}
                        </span>
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
                            onMouseEnter={(e) =>
                              hover.enter(e.currentTarget, u, c, st, openAssignments.get(keyOf(u.id, c.id)))
                            }
                            onMouseLeave={hover.leave}
                          >
                            {/* Eksik hücre eylem menüsü açar: eğitim ya başka
                                yerde alınmış (kayıt girilir) ya da hiç
                                alınmamış (atanır). Dış kaydı yalnızca admin ve
                                kendi departmanının müdürü yazabilir (Firestore
                                kuralı da böyle); eğitmen matrisi görür ama
                                değiştiremez.

                                Metod bazlı eğitimde dolu hücreden de girilir —
                                ikinci bir metod her zaman eklenebilmeli. */}
                            {(canRecordFor(u) || canAssign) &&
                            (st.kind === "MISSING" ||
                              (methodsOf(c).length > 0 && st.kind !== "NA")) ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  hover.closeNow();
                                  setMenu({
                                    user: u,
                                    course: c,
                                    state: st,
                                    rect: e.currentTarget.getBoundingClientRect(),
                                  });
                                }}
                                className="group w-full h-full font-semibold"
                              >
                                <span className="group-hover:hidden">
                                  <Cell state={st} />
                                </span>
                                <span className="hidden group-hover:inline">+ add</span>
                              </button>
                            ) : (
                              <Cell
                                state={st}
                                title={`${u.name} · ${c.title}`}
                                onPreview={(url, t) => setPreview({ url, title: t })}
                              />
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
        <CellDetail
          at={hover.at}
          onEnter={hover.holdOpen}
          onLeave={hover.closeNow}
          onPreviewFile={(url, title) => {
            hover.closeNow();
            setPreview({ url, title });
          }}
          onEditRecord={
            canRecordFor(hover.at.user)
              ? (id) => {
                  hover.closeNow();
                  setEditId(id);
                }
              : undefined
          }
          onRecord={
            canRecordFor(hover.at.user)
              ? () => {
                  const { user, course } = hover.at!;
                  hover.closeNow();
                  setRecord({ user, course });
                }
              : undefined
          }
          onAssign={
            canAssign && canAssignCourse(hover.at.course)
              ? () => {
                  const { user, course } = hover.at!;
                  hover.closeNow();
                  setAssign({ user, course });
                }
              : undefined
          }
        />
      )}

      {/* Hücre eylem menüsü */}
      {menu && (
        <AnchoredCard
          rect={menu.rect}
          width={210}
          estimatedHeight={110}
          onDismiss={() => setMenu(null)}
        >
          <div className="rounded-xl bg-white shadow-xl border border-slate-200 p-1.5 no-print">
            <div className="px-2 pt-1 pb-1.5">
              <p className="text-[12px] font-semibold text-slate-900 leading-tight truncate">
                {menu.user.name}
              </p>
              <p className="text-[10.5px] text-slate-500 leading-tight truncate">
                {menu.course.title}
              </p>
            </div>
            {canRecordFor(menu.user) && (
              <button
                onClick={() => {
                  setRecord({ user: menu.user, course: menu.course });
                  setMenu(null);
                }}
                className="w-full text-left px-2 py-2 rounded-lg text-[12px] font-medium text-slate-800 hover:bg-slate-100"
              >
                + Record training
                <span className="block text-[10px] text-slate-400 font-normal leading-tight">
                  Already taken elsewhere
                </span>
              </button>
            )}
            {!canAssign ? null : canAssignCourse(menu.course) ? (
              <button
                onClick={() => {
                  setAssign({ user: menu.user, course: menu.course });
                  setMenu(null);
                }}
                className="w-full text-left px-2 py-2 rounded-lg text-[12px] font-medium text-slate-800 hover:bg-slate-100"
              >
                + Assign training
                <span className="block text-[10px] text-slate-400 font-normal leading-tight">
                  Take it in the system
                </span>
              </button>
            ) : (
              <p className="px-2 py-2 text-[10.5px] text-slate-400 leading-snug">
                {menu.course.delivery === "EXTERNAL_ONLY"
                  ? "Tracked externally — cannot be assigned."
                  : "Not published — cannot be assigned."}
              </p>
            )}
          </div>
        </AnchoredCard>
      )}

      {/* Tek hücreden atama */}
      {assign && (
        <Modal
          title="Assign Training"
          subtitle={`${assign.user.name} · ${assign.course.title}`}
          onClose={() => setAssign(null)}
        >
          <AssignOne
            userId={assign.user.id}
            courseIds={[assign.course.id]}
            lines={[assign.course.title]}
            onDone={(m) => {
              setToast(m);
              setAssign(null);
            }}
            onCancel={() => setAssign(null)}
          />
        </Modal>
      )}

      {/* Bir kişinin bütün eksikleri */}
      {bulk && (
        <Modal
          title="Assign All Missing"
          subtitle={`${bulk.user.name} · ${bulk.courses.length} training${
            bulk.courses.length === 1 ? "" : "s"
          }`}
          onClose={() => setBulk(null)}
        >
          <AssignOne
            userId={bulk.user.id}
            courseIds={bulk.courses.map((c) => c.id)}
            lines={bulk.courses.map((c) => c.title)}
            onDone={(m) => {
              setToast(m);
              setBulk(null);
            }}
            onCancel={() => setBulk(null)}
          />
        </Modal>
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

      {editRow && (
        <Modal
          title="Edit Training Record"
          subtitle={`${editRow.userName ?? ""} · ${editRow.title ?? ""}`}
          onClose={() => setEditId(null)}
        >
          <ExternalCertForm
            user={{
              id: editRow.userId,
              name: editRow.userName ?? "",
              departmentId: editRow.userDepartmentId ?? null,
            }}
            course={courses.find((c) => c.id === editRow.courseId) ?? null}
            courses={courses}
            existing={editRow}
            onDone={(m) => {
              setToast(m);
              setEditId(null);
            }}
            onCancel={() => setEditId(null)}
          />
        </Modal>
      )}

      {preview && (
        <FilePreview
          url={preview.url}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
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

type AssignmentRow = {
  userId?: string;
  courseId?: string;
  status?: string;
  dueDate?: Timestamp | null;
  contentLanguage?: string;
};

type HoverState = {
  user: UserRow;
  course: CourseRow;
  state: CellState;
  rect: DOMRect;
  /** Bu hücrede açık bir atama varsa — tamamlanmış kayıtla birlikte de olabilir. */
  assignment?: AssignmentRow | null;
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

  const enter = (
    el: HTMLElement,
    user: UserRow,
    course: CourseRow,
    state: CellState,
    assignment?: AssignmentRow | null
  ) => {
    clear();
    holdOpen();
    // Gerekli olmayan hücrede yalnızca muafiyet varsa gösterilecek bir şey var.
    if (state.kind === "NA" && !state.exemptBy) return;
    const rect = el.getBoundingClientRect();
    timer.current = window.setTimeout(
      () => setAt({ user, course, state, rect, assignment }),
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
  onEditRecord,
  onPreviewFile,
  onRecord,
  onAssign,
}: {
  at: HoverState;
  onEnter: () => void;
  onLeave: () => void;
  onEditRecord?: (externalId: string) => void;
  onPreviewFile?: (url: string, title: string) => void;
  /** Eksik hücrede "kayıt gir" — verilmezse yetki yok. */
  onRecord?: () => void;
  /** Eksik hücrede "eğitim ata" — verilmezse yetki yok ya da atanamaz. */
  onAssign?: () => void;
}) {
  const { user, course, state, rect, assignment } = at;
  const W = 260;

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-3 justify-between py-[3px]">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="text-slate-800 font-medium text-right min-w-0 break-words">{v}</span>
    </div>
  );

  return (
    <AnchoredCard rect={rect} width={W} onEnter={onEnter} onLeave={onLeave}>
    <div
      className="rounded-xl bg-white shadow-xl border border-slate-200 px-3.5 py-3 text-[11.5px] no-print"
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
          {state.methodRows.map((r) => {
            const text = !r.date
              ? "no certificate"
              : r.expiry
              ? `${fmt(r.date)} → ${fmt(r.expiry)}`
              : `${fmt(r.date)} · no expiry`;
            const tone = !r.date
              ? "text-red-700 font-semibold"
              : r.expiry && r.expiry.getTime() < Date.now()
              ? "text-red-700 font-medium"
              : "text-slate-800 font-medium";
            return (
              <div key={r.method} className="flex gap-3 justify-between py-[3px] items-baseline">
                <span className="text-slate-500 shrink-0 font-medium">{r.method}</span>
                {/* Her metodun belgesi kendi satırından açılır — metodlu
                    hücre kayıt ekleme düğmesi olduğu için hücreye tıklayarak
                    belgeye ulaşmak mümkün değil. */}
                {r.url ? (
                  <button
                    onClick={() => onPreviewFile?.(r.url!, `${course.title} · ${r.method}`)}
                    className={`text-right min-w-0 underline decoration-slate-300 hover:decoration-brand-500 ${tone}`}
                  >
                    {text} ↗
                  </button>
                ) : (
                  <span className={`text-right min-w-0 ${tone}`}>{text}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {state.kind === "MISSING" && !state.methodsMissing?.length && (
        <p className="text-[11.5px] text-red-700 font-semibold">
          Never taken — required by this person's authorisation scope.
        </p>
      )}

      {/* Eksik hücrede iki yol var: eğitim ya başka yerde alınmış (kayıt
          girilir) ya da hiç alınmamış (atanır). Kart 1 sn bekletip açıldığı
          için eylemler burada da olmalı; yoksa kullanıcı menüyü ikinci kez
          açmak zorunda kalıyor. */}
      {state.kind === "MISSING" && (onRecord || onAssign) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
          {onRecord && (
            <button
              onClick={onRecord}
              className="flex-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md py-1.5"
            >
              + Record
            </button>
          )}
          {onAssign && (
            <button
              onClick={onAssign}
              className="flex-1 text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-md py-1.5"
            >
              + Assign
            </button>
          )}
        </div>
      )}
      {state.kind === "PLANNED" && (
        <p className="text-[11.5px] text-amber-800 font-semibold">
          Assigned but not completed yet.
        </p>
      )}

      {/* Geçerli kaydı olan birine eğitim atanmış olabilir (yenileme). Hücre
          doğru olanı gösteriyor — kayıt hâlâ geçerli — ama atamanın da burada
          görünmesi lazım, yoksa "atadım mı, atamadım mı" belli olmuyor. */}
      {state.kind === "DONE" && assignment && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-[11.5px] text-sky-800 font-semibold">
            Yenileme ataması açık — durum: {assignment.status}
          </p>
          {assignment.dueDate?.toDate?.() && (
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              Son teslim {fmt(assignment.dueDate.toDate())}
              {assignment.dueDate.toDate().getTime() < Date.now() ? " · gecikti" : ""}
            </p>
          )}
          <p className="text-[10.5px] text-slate-400 mt-0.5">
            Tamamlanınca bu hücre yeni tarihe güncellenir.
          </p>
        </div>
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

          {/* Dolu hücrede kaydı düzeltmenin yolu yoktu: tarih yanlış
              girildiyse ya da yeni belge geldiyse kişi sayfasına gitmek
              gerekiyordu. Düzenleme buradan açılıyor. */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-slate-400">
              {state.certificateId || state.externalUrl
                ? "Click the cell to open the certificate."
                : ""}
            </span>
            {onEditRecord && state.externalId && (
              <button
                onClick={() => onEditRecord(state.externalId!)}
                className="text-[11px] font-semibold text-brand-700 hover:underline shrink-0"
              >
                Edit record
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </AnchoredCard>
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
function Cell({
  state,
  title,
  onPreview,
}: {
  state: CellState;
  title?: string;
  onPreview?: (url: string, title: string) => void;
}) {
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
  // Belge yeni sekmede değil, uygulamanın içinde açılır.
  if (state.externalUrl && onPreview) {
    return (
      <button
        onClick={() => onPreview(state.externalUrl!, title ?? "")}
        className="block w-full tabular-nums hover:underline"
      >
        {body}
      </button>
    );
  }
  return (
    <span className="block tabular-nums">
      {body}
    </span>
  );
}
