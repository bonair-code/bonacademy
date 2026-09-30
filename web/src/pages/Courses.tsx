import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import type { Timestamp } from "firebase/firestore";
import { orderBy } from "firebase/firestore";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import { coverTone } from "../lib/coverTone";

type Course = {
  id: string;
  title: string;
  passingScore: number;
  delivery?: "ONLINE" | "EXTERNAL_ONLY";
  isActive: boolean;
  ownerInstructorId: string;
  revisionNo?: string;
  revisionDate?: string | null;
  exam?: { required?: boolean; questionCount?: number } | null;
  category?: string | null;
  durationHours?: number | null;
  recurrenceEvery?: number | null;
  recurrenceUnit?: string | null;
  coverUrl?: string | null;
};

/** Kurs başına bölüm ve soru sayısı — kartta "içeriği var mı" bunu söyler. */
/** `filled` = içinde gerçekten materyal olan bölüm sayısı. */
type Counts = { sections: number; filled: number; questions: number };

type Dialog =
  | { kind: "delete"; course: Course }
  | { kind: "revisions"; course: Course }
  | null;

type Revision = {
  id: string;
  revisionNo: string;
  revisionDate?: string | null;
  note?: string | null;
  publishedByName?: string;
  publishedAt?: Timestamp | null;
  snapshot?: {
    title?: string;
    sectionCount?: number;
    questionCount?: number;
    passingScore?: number | null;
    exam?: { required?: boolean } | null;
  };
};

export function Courses() {
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    // Admin tüm kursları; Eğitmen yalnızca kendi kurslarını görür.
    const base = collection(db, "courses");
    const q =
      role === "ADMIN" ? base : query(base, where("ownerInstructorId", "==", profile.uid));
    return onSnapshot(
      q,
      (snap) => {
        // Bu sayfa yalnızca BİZİM verdiğimiz eğitimler: online ve sınıf.
        // Dışarıdan alınan zorunlu eğitimler Settings → Tracked Trainings'te
        // tanımlanır ve sadece Training Follow-Up'ta görünür.
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Course, "id">) }))
          .filter((r) => r.delivery !== "EXTERNAL_ONLY");
        rows.sort((a, b) => a.title.localeCompare(b.title, "tr"));
        setCourses(rows);
        setLoading(false);
      },
      (e) => {
        setErr(e.message);
        setLoading(false);
      }
    );
  }, [profile, role]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Taslak kursu hemen oluşturup General Information'a götürür — bölümler ve
   * sorular zaten bir kurs id'si istediği için ara pencere gereksiz.
   */
  async function newCourse() {
    if (!profile || creating) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, "courses"), {
        title: "Untitled course",
        category: null,
        durationHours: null,
        recurrenceEvery: null,
        recurrenceUnit: "NONE",
        passingScore: 70,
        isActive: false,
        revisionNo: "",
        revisionDate: null,
        ownerInstructorId: profile.uid,
        // Eğitmen adı kursa yazılır: öğrenci kartında gösteriliyor ve müşteri
        // rolü `users` koleksiyonunu okuyamıyor, isme başka yoldan ulaşamaz.
        ownerInstructorName: profile.name || null,
        scorm: null,
        exam: { questionCount: 10, passingScore: 70, timeLimitMin: null, shuffle: true },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/courses/${ref.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setCreating(false);
    }
  }

  /**
   * Bölüm ve soru sayıları alt koleksiyonlarda. Kurs başına canlı dinleyici
   * açmak yerine liste değiştikçe bir kez okunuyor — sayı kartta bilgi amaçlı,
   * anlık olması gerekmiyor.
   */
  useEffect(() => {
    const ids = courses.map((c) => c.id);
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const out: Record<string, Counts> = {};
      await Promise.all(
        ids.map(async (id) => {
          const [s, q] = await Promise.all([
            getDocs(collection(db, "courses", id, "sections")),
            getDocs(collection(db, "courses", id, "questions")),
          ]);
          const filled = s.docs.filter((d) => {
            const x = d.data() as { contents?: unknown[]; content?: unknown };
            return Array.isArray(x.contents) ? x.contents.length > 0 : x.content != null;
          }).length;
          out[id] = { sections: s.size, filled, questions: q.size };
        })
      );
      if (alive) setCounts(out);
    })().catch((e) => {
      // Sayım patlarsa "Empty" sessizce "Published"a düşüyordu; bu projede
      // aynı kalıptan üç hata çıktı, artık ekranda görünüyor.
      if (alive) setErr(`Bölüm sayıları okunamadı: ${(e as Error).message}`);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.map((c) => c.id).join(",")]);

  /** Yayında olup içeriği olmayan kurslar — listenin üstünde uyarı verilir. */
  const emptyCount = courses.filter((c) => c.isActive && counts[c.id]?.filled === 0).length;

  /**
   * Arama başlığın yanında kategoriye ve revizyon numarasına da bakar;
   * denetimde "Rev 01 olan hangi kurs" diye sorulabiliyor.
   */
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return courses.filter((c) => {
      if (needle) {
        const hay = `${c.title} ${c.category ?? ""} ${c.revisionNo ?? ""}`.toLocaleLowerCase("tr");
        if (!hay.includes(needle)) return false;
      }
      if (!fStatus) return true;
      const empty = counts[c.id]?.filled === 0;
      if (fStatus === "DRAFT") return !c.isActive;
      if (fStatus === "EMPTY") return c.isActive && empty;
      if (fStatus === "PUBLISHED") return c.isActive && !empty;
      return true;
    });
  }, [courses, counts, q, fStatus]);

  /**
   * Yayına al / yayından çıkar. isActive'i artık yalnızca publishCourse
   * Function'ı yazabiliyor: içeriği olmayan kurs yayınlanmasın diye. Buradan
   * doğrudan updateDoc yapmak güvenlik kuralına takılır.
   */
  async function toggleActive(c: Course) {
    setErr(null);
    try {
      await httpsCallable(functions, "publishCourse")({ courseId: c.id, active: !c.isActive });
      setToast(`${c.title} ${c.isActive ? "deactivated" : "activated"}.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div>
      <PageHead
        title="Courses"
        subtitle="Define training, upload content (video, PDF, SCORM) and exam questions."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search course, category or revision…"
          className="input !w-72 !py-1.5 !text-xs"
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs"
        >
          <option value="">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="EMPTY">Published · no content</option>
          <option value="DRAFT">Draft</option>
        </select>
        {(q || fStatus) && (
          <button
            onClick={() => {
              setQ("");
              setFStatus("");
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700"
          >
            Clear
          </button>
        )}
        <span className="text-[12px] font-semibold text-slate-700">
          {shown.length}
          {shown.length !== courses.length ? ` of ${courses.length}` : ""} course
          {courses.length === 1 ? "" : "s"}
        </span>

        <button
          onClick={newCourse}
          disabled={creating}
          className="btn-primary text-xs py-2 ml-auto"
        >
          {creating ? "Creating…" : "+ New Course"}
        </button>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-400">Loading…</div>
      ) : courses.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">No courses yet.</div>
      ) : (
        <>
          {emptyCount > 0 && (
            <p className="mb-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {emptyCount} course{emptyCount === 1 ? " is" : "s are"} published with no content —
              anyone assigned to them cannot do anything.
            </p>
          )}
          {shown.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-400">
              No course matches these filters.
            </div>
          ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {shown.map((c) => (
              <CourseCard
                key={c.id}
                course={c}
                counts={counts[c.id]}
                onOpen={() => navigate(`/courses/${c.id}`)}
                onToggle={() => toggleActive(c)}
                onRevisions={() => setDialog({ kind: "revisions", course: c })}
                onDelete={() => setDialog({ kind: "delete", course: c })}
              />
            ))}
          </div>
          )}
        </>
      )}

      {err && <p className="text-xs text-brand-700 mt-3">{err}</p>}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}

      {dialog?.kind === "revisions" && (
        <Modal
          title="Revision History"
          subtitle={dialog.course.title}
          onClose={() => setDialog(null)}
        >
          <RevisionList courseId={dialog.course.id} />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal
          title="Delete Course"
          subtitle={dialog.course.title}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <DeleteConfirm
            course={dialog.course}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </div>
  );
}

/** "her 2 yılda bir" gibi okunur bir tekrar ifadesi. */
function recurrenceText(c: Course): string {
  if (!c.recurrenceUnit || c.recurrenceUnit === "NONE" || !c.recurrenceEvery) return "One time";
  const unit = c.recurrenceUnit.toLowerCase();
  return `Every ${c.recurrenceEvery} ${unit}${c.recurrenceEvery === 1 ? "" : "s"}`;
}

/**
 * Kurs kartı. Öğrencinin gördüğü kartla aynı kapağı kullanır — yüklenen görsel
 * burada da görünür, "öğrenci bunu nasıl görecek" diye ayrı hesaba girmeye
 * gerek kalmaz. Gövde küçük bir künye: denetimde sorulan alanlar hizalı.
 */
function CourseCard({
  course,
  counts,
  onOpen,
  onToggle,
  onRevisions,
  onDelete,
}: {
  course: Course;
  counts?: Counts;
  onOpen: () => void;
  onToggle: () => void;
  onRevisions: () => void;
  onDelete: () => void;
}) {
  const tone = coverTone(course.title);
  const sections = counts?.sections;
  // İçeriği olmayan bir kurs yayında olmamalı: atanan kişi boş ekranla karşılaşır.
  const empty = sections === 0;
  const status = !course.isActive
    ? { label: "Draft", cls: "bg-slate-100 text-slate-600" }
    : empty
    ? { label: "Empty", cls: "bg-amber-50 text-amber-800" }
    : { label: "Published", cls: "bg-emerald-50 text-emerald-700" };

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 border-t border-slate-100 first:border-t-0 text-[11.5px]">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className="font-medium text-slate-800 text-right min-w-0 truncate">{v}</span>
    </div>
  );

  return (
    <div className="card overflow-hidden flex flex-col">
      <button
        onClick={onOpen}
        className="relative h-[96px] shrink-0 flex flex-col justify-end text-left px-3.5 py-2.5"
        style={
          course.coverUrl
            ? {
                backgroundImage: `url(${course.coverUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { background: `linear-gradient(140deg, ${tone.from}, ${tone.to})` }
        }
      >
      </button>

      {/* Başlık kapağın ALTINDA: yüklenen kapak zaten yazı içerdiği için
          üstüne yazmak iki metni de okunmaz kılıyordu. */}
      <button onClick={onOpen} className="px-3.5 pt-3 text-left">
        {course.category && (
          <span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {course.category}
          </span>
        )}
        <span className="block text-[12.5px] font-semibold text-slate-900 leading-snug line-clamp-2">
          {course.title}
        </span>
      </button>

      <div className="px-3.5 pt-2.5 pb-3 flex-1 flex flex-col">
        <div>
          {row(
            "Content",
            counts === undefined ? (
              "—"
            ) : empty ? (
              <span className="text-amber-700">No content</span>
            ) : (
              `${sections} section${sections === 1 ? "" : "s"}${
                counts.questions ? ` · ${counts.questions} questions` : ""
              }`
            )
          )}
          {row(
            "Exam",
            course.exam?.required === false ? "Not required" : `Pass mark ${course.passingScore}%`
          )}
          {row("Duration", course.durationHours != null ? `${course.durationHours} hours` : "—")}
          {row("Recurrence", recurrenceText(course))}
          {row(
            "Revision",
            course.revisionNo
              ? `${course.revisionNo}${
                  course.revisionDate
                    ? ` · ${course.revisionDate.split("-").reverse().join(".")}`
                    : ""
                }`
              : "—"
          )}
        </div>

        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span
            className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded ${status.cls}`}
          >
            {status.label}
          </span>
          <div className="flex items-center gap-1">
            <Link
              to={`/courses/${course.id}`}
              className="text-[11.5px] font-semibold text-brand-700 hover:underline"
            >
              Edit
            </Link>
            <RowMenu
              label={`Actions for ${course.title}`}
              items={[
                { label: "Edit / Content", icon: "✎", onClick: onOpen },
                {
                  label: course.isActive ? "Deactivate" : "Activate",
                  icon: course.isActive ? "⦸" : "✓",
                  onClick: onToggle,
                },
                { label: "Revision History", icon: "⟲", onClick: onRevisions },
                { label: "Delete", icon: "🗑", danger: true, onClick: onDelete },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  course,
  onDone,
  onCancel,
}: {
  course: Course;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await deleteDoc(doc(db, "courses", course.id));
      onDone(`${course.title} deleted.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-700 mb-2">
        Delete <strong>{course.title}</strong>? Staff already assigned keep their records, but the
        course disappears from the catalogue.
      </p>
      <p className="text-[11px] text-slate-500">
        Deactivating instead hides it from new assignments and is reversible.
      </p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button onClick={remove} disabled={busy} className="btn-primary text-xs py-2">
          {busy ? "Deleting…" : "Delete Course"}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}

/** Kursun yayın geçmişi — her satır bir revizyonun anlık kopyası. */
function RevisionList({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "courses", courseId, "revisions"), orderBy("publishedAt", "desc")),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Revision, "id">) })));
        setLoading(false);
      },
      (e) => {
        setErr(e.message);
        setLoading(false);
      }
    );
  }, [courseId]);

  if (loading) return <p className="text-sm text-slate-400 py-4">Loading…</p>;
  if (err) return <p className="text-xs text-brand-700 py-2">{err}</p>;
  if (rows.length === 0)
    return (
      <p className="text-sm text-slate-400 py-6 text-center">
        No revisions yet — publish the course from Summary &amp; Publish to record one.
      </p>
    );

  return (
    <ol className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="py-3 flex items-start gap-3">
          <span className="shrink-0 rounded-md bg-brand-50 text-brand-700 text-[11px] font-bold px-2 py-1 tabular-nums">
            {r.revisionNo || "—"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-900 truncate">
              {r.snapshot?.title || "—"}
            </div>
            <div className="text-[11px] text-slate-500">
              {r.snapshot?.sectionCount ?? 0} section(s) ·{" "}
              {r.snapshot?.exam?.required === false
                ? "no exam"
                : `${r.snapshot?.questionCount ?? 0} question(s), pass mark ${
                    r.snapshot?.passingScore ?? "—"
                  }%`}
            </div>
            {r.note && <div className="text-[11px] text-slate-600 mt-0.5">{r.note}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-500 tabular-nums">
              {r.publishedAt?.toDate?.().toLocaleDateString("tr-TR") ?? "—"}
            </div>
            <div className="text-[10px] text-slate-400 truncate max-w-[130px]">
              {r.publishedByName || ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
