/**
 * Eğitmen yetkileri — kim hangi konuyu öğretebilir.
 *
 * Kâğıttaki "TRAINER" tablosunun karşılığı: satır eğitmen, sütun konu,
 * hücre tik; artı kişi başına tek bir yetki bitiş tarihi. Eğitim takip
 * matrisinden ayrı bir şey — orası "aldı mı", burası "öğretebilir mi".
 *
 * Yetki GERÇEKTEN kısıtlıyor: yetkisi olmayan eğitmen o kurs için sınıf
 * oturumu açamaz (bkz. lib/instructors.ts → canTeach, firestore.rules).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { authDaysLeft, authExpiryOf, authValid } from "../lib/instructors";
import { fmt } from "../lib/records";

type Row = {
  id: string;
  name: string;
  role: string;
  isActive?: boolean;
  departmentId?: string | null;
  instructorFor?: string[];
  instructorAuthExpiry?: Timestamp | null;
};
type Course = { id: string; title: string; category?: string };

const iso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function Instructors() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [depts, setDepts] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, "users"), orderBy("name")),
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (e) => setErr(e.message)
      ),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepts(new Map(s.docs.map((d) => [d.id, (d.data() as any).name])))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Yalnızca eğitmenler; admin listede yok çünkü zaten her şeyi yapabiliyor. */
  const instructors = useMemo(
    () => rows.filter((u) => u.role === "INSTRUCTOR" && u.isActive !== false),
    [rows]
  );

  async function toggle(u: Row, courseId: string) {
    const has = u.instructorFor?.includes(courseId);
    const next = has
      ? (u.instructorFor ?? []).filter((x) => x !== courseId)
      : [...(u.instructorFor ?? []), courseId];
    setBusy(`${u.id}|${courseId}`);
    setErr(null);
    try {
      await updateDoc(doc(db, "users", u.id), { instructorFor: next });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setExpiry(u: Row, value: string) {
    setErr(null);
    try {
      await updateDoc(doc(db, "users", u.id), {
        instructorAuthExpiry: value ? Timestamp.fromDate(new Date(value)) : null,
      });
      setToast(`${u.name} — authorisation date saved.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (role !== "ADMIN")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  return (
    <div>
      {/* Form numarasi yok: kagit karsiligi ayri bir form ve numarasini
          bilmiyoruz; yanlis numara basmak denetimde bulgu olur. */}
      <PageHead title="Instructor Authorisations" />

      <div className="no-print border-b border-slate-200 mb-3">
        <nav className="flex gap-0.5 pb-2" aria-label="Follow-up sections">
          <Link
            to="/follow-up"
            className="px-3.5 py-2 text-[13.5px] -mb-[9px] border-b-2 border-transparent text-slate-500 hover:text-slate-800"
          >
            Training
          </Link>
          <Link
            to="/follow-up"
            className="px-3.5 py-2 text-[13.5px] -mb-[9px] border-b-2 border-transparent text-slate-500 hover:text-slate-800"
          >
            Borescope &amp; Run-Up
          </Link>
          <span className="px-3.5 py-2 text-[13.5px] -mb-[9px] border-b-2 border-brand-600 text-brand-700 font-semibold">
            Instructors
            <span className="text-[10.5px] text-slate-400 ml-1.5">{instructors.length}</span>
          </span>
        </nav>
      </div>

      {err && <p className="text-xs text-red-700 mb-2">{err}</p>}

      {instructors.length === 0 ? (
        <p className="text-sm text-slate-400 py-10">
          No active instructors yet — set a person&rsquo;s role to Instructor in Users.
        </p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full matrix-table">
            <thead>
              <tr>
                <th className="th sticky left-0 bg-white z-10 min-w-[190px] text-left">Instructor</th>
                <th className="th min-w-[130px] text-left">Authorisation until</th>
                {courses.map((c) => (
                  <th key={c.id} className="th min-w-[42px] max-w-[42px] align-bottom">
                    {/* Başlıklar dik: 18+ sütun yatay yazıyla sığmıyor. */}
                    <span
                      className="block whitespace-nowrap text-[11px] font-medium text-slate-600"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 150 }}
                      title={c.title}
                    >
                      {c.title}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instructors.map((u) => {
                const days = authDaysLeft(u);
                const valid = authValid(u);
                return (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="td sticky left-0 bg-white z-10">
                      <Link to={`/team/${u.id}`} className="font-medium text-slate-900 hover:underline">
                        {u.name}
                      </Link>
                      <span className="block text-[11px] text-slate-400">
                        {depts.get(u.departmentId ?? "") ?? "No department"}
                      </span>
                    </td>
                    <td className="td">
                      <input
                        type="date"
                        className="input !py-1 !text-[12px] !w-[130px]"
                        value={iso(authExpiryOf(u))}
                        onChange={(e) => void setExpiry(u, e.target.value)}
                      />
                      <span
                        className={`block text-[11px] mt-0.5 ${
                          !valid ? "text-red-700 font-semibold" : days !== null && days <= 90 ? "text-amber-700" : "text-slate-400"
                        }`}
                      >
                        {days === null
                          ? "no expiry"
                          : days < 0
                          ? `expired ${fmt(authExpiryOf(u))}`
                          : `${days} days left`}
                      </span>
                    </td>
                    {courses.map((c) => {
                      const on = !!u.instructorFor?.includes(c.id);
                      const saving = busy === `${u.id}|${c.id}`;
                      return (
                        <td key={c.id} className="td text-center p-0">
                          <button
                            type="button"
                            onClick={() => void toggle(u, c.id)}
                            disabled={saving}
                            aria-pressed={on}
                            aria-label={`${u.name} — ${c.title}`}
                            title={`${u.name} — ${c.title}`}
                            className={`w-full h-9 grid place-items-center text-[13px] font-bold transition ${
                              on
                                ? valid
                                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-red-50 text-red-700 hover:bg-red-100"
                                : "text-slate-200 hover:bg-slate-100 hover:text-slate-400"
                            } ${saving ? "opacity-40" : ""}`}
                          >
                            {on ? "✕" : "·"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11.5px] text-slate-500 mt-3 max-w-[80ch]">
        A ticked subject means that instructor may teach it — they can open a class session and
        issue certificates for it. The authorisation date applies to the person as a whole:
        once it passes, every subject stops counting until it is renewed.
      </p>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl no-print">
          {toast}
        </div>
      )}
    </div>
  );
}
