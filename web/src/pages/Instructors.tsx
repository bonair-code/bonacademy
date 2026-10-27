/**
 * Eğitmen yetkileri — kim hangi konuyu öğretebilir.
 *
 * Kâğıttaki "TRAINER" tablosunun karşılığı. Eğitim takip matrisinden ayrı
 * bir şey: orası "aldı mı", burası "öğretebilir mi".
 *
 * Yetki GERÇEKTEN kısıtlıyor: yetkisi olmayan eğitmen o kurs için sınıf
 * oturumu açamaz (bkz. lib/instructors.ts → canTeach, firestore.rules).
 *
 * Düzen neden matris değil: önce eğitmen × konu matrisiydi, konu başlıkları
 * dikey yazılıyordu. 18 konuda başlıklar 150px'te kırpıldı, hücreler
 * başlıkların altına oturmadı ve tek eğitmenlik tablo bomboş göründü.
 * Kişi başına kart + sarmalayan konu rozetleri kırpılmıyor, telefonda da
 * çalışıyor.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { authDaysLeft, authExpiryOf, authValid } from "../lib/instructors";
import { hasRole } from "../lib/roles";
import { fmt } from "../lib/records";

type Row = {
  id: string;
  name: string;
  role?: string | null;
  roles?: string[] | null;
  isActive?: boolean;
  departmentId?: string | null;
  instructorFor?: string[];
  instructorAuthExpiry?: Timestamp | null;
};
type Course = { id: string; title: string };

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
        (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, "id">) }))),
        (e) => setErr(e.message)
      ),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Course, "id">) })))
      ),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepts(new Map(s.docs.map((d) => [d.id, (d.data() as { name: string }).name])))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Eğitmen rolü TAŞIYAN herkes — tek rolü eğitmen olmak gerekmiyor, bir
   * kişi hem yönetici hem eğitmen olabilir. Sade admin listede yok: zaten
   * her konuyu öğretebiliyor, yetkilendirmeye ihtiyacı yok.
   */
  const instructors = useMemo(
    () => rows.filter((u) => hasRole(u, "INSTRUCTOR") && u.isActive !== false),
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
      {/* Form numarası yok: kâğıt karşılığı ayrı bir form ve numarasını
          bilmiyoruz; yanlış numara basmak denetimde bulgu olur. */}
      <PageHead title="Instructor Authorisations" />

      {err && <p className="text-xs text-red-700 mb-2">{err}</p>}

      {instructors.length === 0 ? (
        <p className="text-sm text-slate-400 py-10">
          No active instructors yet — set a person&rsquo;s role to Instructor in Users.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {instructors.map((u) => {
            const days = authDaysLeft(u);
            const valid = authValid(u);
            const on = new Set(u.instructorFor ?? []);
            return (
              <section key={u.id} className="card p-0 overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-100">
                  <div className="min-w-0">
                    <Link
                      to={`/team/${u.id}`}
                      className="font-semibold text-[15px] text-slate-900 hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="block text-[12px] text-slate-500">
                      {depts.get(u.departmentId ?? "") ?? "No department"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div>
                      <label
                        htmlFor={`exp-${u.id}`}
                        className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400"
                      >
                        Authorisation until
                      </label>
                      <input
                        id={`exp-${u.id}`}
                        type="date"
                        className="input !py-1 !text-[12.5px] !w-[150px] mt-0.5"
                        value={iso(authExpiryOf(u))}
                        onChange={(e) => void setExpiry(u, e.target.value)}
                      />
                    </div>
                    <span
                      className={`self-end mb-1.5 text-[11.5px] font-semibold whitespace-nowrap ${
                        !valid
                          ? "text-red-700"
                          : days !== null && days <= 90
                            ? "text-amber-700"
                            : "text-slate-400"
                      }`}
                    >
                      {days === null
                        ? "no expiry"
                        : days < 0
                          ? `expired ${fmt(authExpiryOf(u))}`
                          : `${days} days left`}
                    </span>
                  </div>
                </header>

                <div className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3 mb-2.5">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                      May teach
                    </h3>
                    <span className="text-[11.5px] text-slate-400">
                      {on.size} of {courses.length} subjects
                    </span>
                  </div>
                  {/* Rozetler sarmalıyor: başlık ne kadar uzun olursa olsun
                      kırpılmıyor — dikey sütun başlıklarının sorunu buydu. */}
                  <div className="flex flex-wrap gap-1.5">
                    {courses.map((c) => {
                      const ticked = on.has(c.id);
                      const saving = busy === `${u.id}|${c.id}`;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => void toggle(u, c.id)}
                          disabled={saving}
                          aria-pressed={ticked}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] text-left transition ${
                            ticked
                              ? valid
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100"
                                : "border-red-200 bg-red-50 text-red-800 font-semibold hover:bg-red-100"
                              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                          } ${saving ? "opacity-40" : ""}`}
                        >
                          <span
                            aria-hidden
                            className={`grid place-items-center h-4 w-4 shrink-0 rounded-[5px] border text-[10px] leading-none ${
                              ticked
                                ? valid
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-red-600 bg-red-600 text-white"
                                : "border-slate-300 bg-white text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          {c.title}
                        </button>
                      );
                    })}
                  </div>
                  {on.size > 0 && !valid && (
                    <p className="text-[11.5px] text-red-700 mt-2.5 font-medium">
                      Authorisation has expired — none of these subjects count until the date
                      above is renewed.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11.5px] text-slate-500 mt-4 max-w-[80ch]">
        A ticked subject means that instructor may teach it — they can open a class session and
        issue certificates for it. The authorisation date applies to the person as a whole: once
        it passes, every subject stops counting until it is renewed.
      </p>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl no-print">
          {toast}
        </div>
      )}
    </div>
  );
}
