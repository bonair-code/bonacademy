import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { isStaffRole, useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { PrintButton } from "../components/PrintButton";

/**
 * Eğitim atama — tek ekran.
 *
 * Atama eskiden yalnızca Users satır menüsünde, kişi kişi yapılabiliyordu:
 * bir eğitimi 20 kişiye vermek 20 ayrı pencere demekti ve "kime ne zaman ne
 * atadım" sorusunun cevabı hiçbir yerde yoktu. Burada ikisi bir arada:
 * üstte toplu atama, altta bütün atamaların listesi.
 */

type Assignment = {
  id: string;
  userId: string;
  userDepartmentId?: string | null;
  courseId: string;
  courseTitle: string;
  status: string;
  dueDate?: Timestamp | null;
  createdAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  completedVia?: string | null;
  triggeredBy?: string | null;
};
type UserRow = {
  id: string;
  name: string;
  departmentId: string | null;
  jobTitleIds?: string[];
  isActive?: boolean;
  role?: string;
};
type CourseRow = { id: string; title: string; delivery?: string; isActive?: boolean };

const DAY = 86400000;
const fmt = (t?: Timestamp | null) => t?.toDate?.().toLocaleDateString("tr-TR") ?? "—";

/** Durumun okunur karşılığı ve rengi. */
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Not started", cls: "bg-slate-100 text-slate-600" },
  IN_PROGRESS: { label: "In progress", cls: "bg-sky-50 text-sky-700" },
  SECTIONS_DONE: { label: "Ready for exam", cls: "bg-amber-50 text-amber-800" },
  EXAM_FAILED: { label: "Exam failed", cls: "bg-red-50 text-red-700" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  EXAM_PASSED: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
};
const isDone = (s: string) => s === "COMPLETED" || s === "EXAM_PASSED";

export function Assignments() {
  const { profile, role } = useAuth();
  const [rows, setRows] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [departments, setDepartments] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [fCourse, setFCourse] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDept, setFDept] = useState("");

  useEffect(() => {
    if (!profile || !role) return;
    // Müdür yalnızca kendi departmanını okuyabilir; kapsamsız sorgu komple
    // reddedilir, o yüzden sorgular role göre daraltılıyor.
    const seesAll = role === "ADMIN" || role === "INSTRUCTOR";
    const scoped = (name: string, field: string) =>
      seesAll
        ? query(collection(db, name))
        : query(collection(db, name), where(field, "==", profile.departmentId));

    const subs = [
      onSnapshot(
        scoped("assignments", "userDepartmentId"),
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (e) => setErr(e.message)
      ),
      onSnapshot(scoped("users", "departmentId"), (s) =>
        setUsers(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(collection(db, "courses"), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepartments(new Map(s.docs.map((d) => [d.id, (d.data() as any).name])))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [profile, role]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  /** Atanabilir eğitimler: dışarıdan alınanlar sistemde tamamlanamaz. */
  const assignable = useMemo(
    () => courses.filter((c) => c.delivery !== "EXTERNAL_ONLY").sort((a, b) => a.title.localeCompare(b.title, "tr")),
    [courses]
  );

  const now = Date.now();
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return rows
      .filter((a) => (fCourse ? a.courseId === fCourse : true))
      .filter((a) => (fDept ? (userById.get(a.userId)?.departmentId ?? null) === fDept : true))
      .filter((a) => {
        if (!fStatus) return true;
        if (fStatus === "OPEN") return !isDone(a.status);
        if (fStatus === "DONE") return isDone(a.status);
        if (fStatus === "OVERDUE")
          return !isDone(a.status) && (a.dueDate?.toMillis?.() ?? Infinity) < now;
        return a.status === fStatus;
      })
      .filter((a) =>
        needle
          ? `${userById.get(a.userId)?.name ?? ""} ${a.courseTitle}`
              .toLocaleLowerCase("tr")
              .includes(needle)
          : true
      )
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [rows, q, fCourse, fStatus, fDept, userById, now]);

  const tally = useMemo(() => {
    let open = 0;
    let done = 0;
    let overdue = 0;
    for (const a of rows) {
      if (isDone(a.status)) done++;
      else {
        open++;
        if ((a.dueDate?.toMillis?.() ?? Infinity) < now) overdue++;
      }
    }
    return { open, done, overdue };
  }, [rows, now]);

  if (role !== "ADMIN" && role !== "MANAGER")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  return (
    <div>
      <PageHead
        title="Assign Training"
        subtitle="Give training to one person or a whole group, and follow what happened next."
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tally n={tally.open} label="Open" tone="#1d1d1f" />
        <Tally n={tally.overdue} label="Past due" tone="#b3241f" />
        <Tally n={tally.done} label="Completed" tone="#1f7a3c" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search person or training…"
          className="input !w-64 !py-1.5 !text-xs no-print"
        />
        <select
          value={fCourse}
          onChange={(e) => setFCourse(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs no-print"
        >
          <option value="">All trainings</option>
          {assignable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          value={fDept}
          onChange={(e) => setFDept(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs no-print"
        >
          <option value="">All departments</option>
          {[...departments.entries()].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs no-print"
        >
          <option value="">Any status</option>
          <option value="OPEN">Open</option>
          <option value="OVERDUE">Past due</option>
          <option value="DONE">Completed</option>
          <option value="PENDING">Not started</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="SECTIONS_DONE">Ready for exam</option>
          <option value="EXAM_FAILED">Exam failed</option>
        </select>
        {(q || fCourse || fStatus || fDept) && (
          <button
            onClick={() => {
              setQ("");
              setFCourse("");
              setFStatus("");
              setFDept("");
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 no-print"
          >
            Clear
          </button>
        )}
        <span className="text-[12px] font-semibold text-slate-700">
          {shown.length}
          {shown.length !== rows.length ? ` of ${rows.length}` : ""} assignment
          {rows.length === 1 ? "" : "s"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <PrintButton />
          <button onClick={() => setOpen(true)} className="btn-primary text-xs py-2 no-print">
            + Assign Training
          </button>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="th">Person</th>
                <th className="th">Training</th>
                <th className="th">Assigned</th>
                <th className="th">Due</th>
                <th className="th">Status</th>
                <th className="th">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    {rows.length === 0
                      ? "No training has been assigned yet."
                      : "No assignment matches these filters."}
                  </td>
                </tr>
              )}
              {shown.map((a) => {
                const u = userById.get(a.userId);
                const due = a.dueDate?.toMillis?.() ?? null;
                const late = !isDone(a.status) && due !== null && due < now;
                const st = STATUS[a.status] ?? { label: a.status, cls: "bg-slate-100 text-slate-600" };
                return (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="td font-semibold text-slate-900">
                      {u ? (
                        <Link to={`/team/${a.userId}`} className="hover:text-brand-700 hover:underline">
                          {u.name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">Unknown user</span>
                      )}
                      <span className="block text-[11px] font-normal text-slate-400">
                        {departments.get(u?.departmentId ?? "") ?? "—"}
                      </span>
                    </td>
                    <td className="td text-slate-700">{a.courseTitle}</td>
                    <td className="td tabular-nums text-slate-500">{fmt(a.createdAt)}</td>
                    <td className="td tabular-nums">
                      <span className={late ? "text-red-700 font-semibold" : "text-slate-500"}>
                        {fmt(a.dueDate)}
                      </span>
                      {late && due !== null && (
                        <span className="block text-[10.5px] text-red-700">
                          {Math.round((now - due) / DAY)} days late
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <span
                        className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="td tabular-nums text-slate-500">
                      {isDone(a.status) ? (
                        <>
                          {fmt(a.completedAt)}
                          {a.completedVia && (
                            <span className="block text-[10.5px] text-slate-400">
                              {a.completedVia === "EXTERNAL"
                                ? "external certificate"
                                : a.completedVia === "CLASSROOM"
                                ? "classroom"
                                : a.completedVia.toLowerCase()}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {err && <p className="px-5 py-3 text-xs text-brand-700 border-t border-slate-100">{err}</p>}
      </div>

      {open && (
        <Modal title="Assign Training" onClose={() => setOpen(false)} width="max-w-3xl">
          <AssignForm
            users={users.filter((u) => u.isActive !== false && isStaffRole(u.role))}
            courses={assignable}
            departments={departments}
            existing={rows}
            onDone={(m) => {
              setToast(m);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
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

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="card px-4 py-3">
      <div
        className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.025em]"
        style={{ color: tone }}
      >
        {n}
      </div>
      <div className="text-[11.5px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

/**
 * Atama penceresi. İki yön:
 *
 *   BY_COURSE — bir eğitim, çok kişi. "Safety Training'i 20 kişiye ver."
 *   BY_PERSON — bir kişi, çok eğitim. "Yeni giren adama 6 eğitimi birden ver."
 *
 * İkisi de gerçek iş: ilki dönemsel yenilemeler, ikincisi işe yeni başlayan
 * personel. Tek yön bırakmak birini 20 pencere açmaya zorluyordu.
 *
 * Zaten atanmış olan kalemler işaretlenemez — `assignCourses` onları zaten
 * atlıyor, ama seçilebilir göstermek "20 kişiye atadım" deyip 12'sinin
 * sessizce atlanmasına yol açıyordu.
 */
function AssignForm({
  users,
  courses,
  departments,
  existing,
  onDone,
  onCancel,
}: {
  users: UserRow[];
  courses: CourseRow[];
  departments: Map<string, string>;
  existing: Assignment[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"BY_COURSE" | "BY_PERSON">("BY_COURSE");
  /** Seçilen taraf: eğitime göre kurs id, kişiye göre kullanıcı id. */
  const [anchor, setAnchor] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const byCourse = mode === "BY_COURSE";

  function switchMode(m: "BY_COURSE" | "BY_PERSON") {
    setMode(m);
    setAnchor("");
    setPicked(new Set());
    setQ("");
    setDept("");
  }

  /** Bu seçim için zaten atanmış olanlar. */
  const already = useMemo(() => {
    if (!anchor) return new Set<string>();
    return new Set(
      byCourse
        ? existing.filter((a) => a.courseId === anchor).map((a) => a.userId)
        : existing.filter((a) => a.userId === anchor).map((a) => a.courseId)
    );
  }, [existing, anchor, byCourse]);

  /** İşaretlenecek kalemler: kişiler ya da eğitimler. */
  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    if (byCourse) {
      return users
        .filter((u) => (dept ? u.departmentId === dept : true))
        .filter((u) => (needle ? u.name.toLocaleLowerCase("tr").includes(needle) : true))
        .map((u) => ({
          id: u.id,
          label: u.name,
          note: departments.get(u.departmentId ?? "") ?? "—",
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "tr"));
    }
    return courses
      .filter((c) => (needle ? c.title.toLocaleLowerCase("tr").includes(needle) : true))
      .map((c) => ({
        id: c.id,
        label: c.title,
        note: c.isActive === false ? "draft" : "",
      }));
  }, [byCourse, users, courses, dept, q, departments]);

  const selectable = list.filter((x) => !already.has(x.id));
  const allPicked = selectable.length > 0 && selectable.every((x) => picked.has(x.id));

  async function submit() {
    if (!anchor || picked.size === 0) return;
    setBusy(true);
    setErr(null);
    setProgress(0);
    try {
      const fn = httpsCallable(functions, "assignCourses");
      let created = 0;

      if (byCourse) {
        // Fonksiyon kişi başına çalışıyor; kişiler döngüyle geçiliyor.
        for (const uid of Array.from(picked)) {
          const res = await fn({ userId: uid, courseIds: [anchor] });
          created += (res.data as { created?: number })?.created ?? 0;
          setProgress((p) => p + 1);
        }
        const title = courses.find((c) => c.id === anchor)?.title ?? "Training";
        onDone(`${title} assigned to ${created} ${created === 1 ? "person" : "people"}.`);
      } else {
        // Tek kişiye çok eğitim: fonksiyon bunu tek çağrıda yapıyor.
        const res = await fn({ userId: anchor, courseIds: Array.from(picked) });
        created = (res.data as { created?: number })?.created ?? 0;
        setProgress(picked.size);
        const name = users.find((u) => u.id === anchor)?.name ?? "the employee";
        onDone(`${created} training${created === 1 ? "" : "s"} assigned to ${name}.`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Yön seçimi */}
      <div className="inline-flex w-full bg-slate-100 rounded-[9px] p-0.5 mb-4">
        {(
          [
            { key: "BY_COURSE", label: "By training" },
            { key: "BY_PERSON", label: "By person" },
          ] as const
        ).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => switchMode(o.key)}
            className={`flex-1 text-[12px] font-semibold px-3 py-1.5 rounded-[7px] transition ${
              mode === o.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <label className="label">{byCourse ? "Training" : "Person"}</label>
        <select
          className="input"
          value={anchor}
          onChange={(e) => {
            setAnchor(e.target.value);
            setPicked(new Set());
          }}
        >
          <option value="">— Select —</option>
          {byCourse
            ? courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.isActive === false ? " (draft)" : ""}
                </option>
              ))
            : [...users]
                .sort((a, b) => a.name.localeCompare(b.name, "tr"))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.departmentId ? ` — ${departments.get(u.departmentId) ?? ""}` : ""}
                  </option>
                ))}
        </select>
      </div>

      {anchor && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={byCourse ? "Search name…" : "Search training…"}
              className="input !w-48 !py-1.5 !text-xs"
            />
            {byCourse && (
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className="input !w-auto !py-1.5 !text-xs"
              >
                <option value="">All departments</option>
                {[...departments.entries()].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (allPicked) selectable.forEach((x) => n.delete(x.id));
                  else selectable.forEach((x) => n.add(x.id));
                  return n;
                })
              }
              disabled={selectable.length === 0}
              className="text-[11px] font-semibold text-brand-700 hover:underline disabled:opacity-40"
            >
              {allPicked ? "Clear selection" : `Select all ${selectable.length}`}
            </button>
            <span className="text-[11.5px] text-slate-500 ml-auto">
              {picked.size} selected
              {already.size > 0 ? ` · ${already.size} already assigned` : ""}
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 max-h-72 overflow-auto divide-y divide-slate-100">
            {list.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-400">Nothing matches.</p>
            )}
            {list.map((x) => {
              const has = already.has(x.id);
              return (
                <label
                  key={x.id}
                  className={`flex items-center gap-2.5 px-3 py-2 text-[13px] ${
                    has ? "opacity-50" : "hover:bg-slate-50 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-brand-600 h-3.5 w-3.5"
                    disabled={has}
                    checked={picked.has(x.id)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(x.id);
                        else n.delete(x.id);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1 min-w-0 truncate text-slate-800">{x.label}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {has ? "already assigned" : x.note}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}

      <div className="-mx-[18px] -mb-[18px] mt-5 px-[18px] py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
        {err ? (
          <span className="text-[11.5px] text-brand-700 mr-auto">{err}</span>
        ) : (
          <span className="text-[11.5px] text-slate-400 mr-auto">
            {busy
              ? `Assigning… ${progress}/${picked.size}`
              : !anchor
              ? byCourse
                ? "Pick a training first."
                : "Pick a person first."
              : picked.size === 0
              ? byCourse
                ? "Pick who should take it."
                : "Pick the training to assign."
              : "Due in 30 days from today."}
          </span>
        )}
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !anchor || picked.size === 0}
          className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Assigning…" : `Assign ${picked.size}`}
        </button>
      </div>
    </div>
  );
}