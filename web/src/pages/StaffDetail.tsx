import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import { ExternalCertForm } from "../components/ExternalCertForm";
import { requirementFor } from "../lib/requirements";
import { PrintButton } from "../components/PrintButton";

type UserRow = {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  jobTitleIds?: string[];
  subScopeIds?: string[];
  isActive?: boolean;
};
type CourseRow = {
  id: string;
  title: string;
  isActive?: boolean;
  recurrenceEvery?: number | null;
  recurrenceUnit?: string;
};
type ExternalRow = {
  id: string;
  courseId: string | null;
  title: string;
  provider: string;
  completedAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
  fileUrl?: string;
  externalSerialNo?: string | null;
  /** Metod bazlı eğitimde bu kaydın metodu (ör. NDT → PT). */
  method?: string | null;
};

const DAY = 86400000;

function addValidity(base: Date, every?: number | null, unit?: string): Date | null {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}
const fmt = (d?: Date | null) => (d ? d.toLocaleDateString("tr-TR") : "—");

type Line = {
  course: CourseRow;
  required: boolean;
  state: "DONE" | "PLANNED" | "MISSING";
  date: Date | null;
  expires: Date | null;
  days: number | null;
  external: ExternalRow | null;
  certificateId: string | null;
};

export function StaffDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { profile, role } = useAuth();

  const [user, setUser] = useState<UserRow | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [jobTitles, setJobTitles] = useState<
    { id: string; name: string; requiredCourseIds?: string[]; subScopes?: { id: string; name: string; requiredCourseIds?: string[] }[] }[]
  >([]);
  const [departments, setDepartments] = useState<Map<string, string>>(new Map());
  const [certs, setCerts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [externals, setExternals] = useState<ExternalRow[]>([]);
  const [dialog, setDialog] = useState<
    | { kind: "add"; course: CourseRow | null }
    | { kind: "remove"; row: ExternalRow }
    | { kind: "edit"; row: ExternalRow }
    | { kind: "force"; line: Line }
    | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !profile) return;
    const onErr = (e: { message: string }) => setErr(e.message);
    const subs = [
      onSnapshot(doc(db, "users", userId), (d) =>
        setUser(d.exists() ? ({ id: d.id, ...(d.data() as any) }) : null), onErr),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))),
      onSnapshot(collection(db, "jobTitles"), (s) =>
        setJobTitles(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepartments(new Map(s.docs.map((d) => [d.id, (d.data() as any).name])))),
      onSnapshot(query(collection(db, "certificates"), where("userId", "==", userId)), (s) =>
        setCerts(s.docs.map((d) => ({ __id: d.id, ...(d.data() as any) }))), onErr),
      onSnapshot(query(collection(db, "assignments"), where("userId", "==", userId)), (s) =>
        setAssignments(s.docs.map((d) => d.data())), onErr),
      onSnapshot(query(collection(db, "externalTrainings"), where("userId", "==", userId)), (s) =>
        setExternals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), onErr),
    ];
    return () => subs.forEach((u) => u());
  }, [userId, profile]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Zorunluluk tek kaynaktan: kişinin authorisation scope'ları ve her kapsamın
  // gerekli eğitim listesi. Kapsamı olmayan personelde kurs N/A kalır.
  const requiredIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) {
      if (requirementFor(c, user?.jobTitleIds ?? [], jobTitles, user?.subScopeIds ?? []))
        set.add(c.id);
    }
    return set;
  }, [courses, jobTitles, user]);

  // Kişinin ilgili olduğu her kurs: zorunlu olanlar + atanmışlar + tamamlananlar.
  const lines: Line[] = useMemo(() => {
    const assignedIds = new Set(
      assignments
        .filter((a) => a.status !== "COMPLETED" && a.status !== "EXAM_PASSED")
        .map((a) => a.courseId)
    );
    const certByCourse = new Map<string, { date: Date; id: string }>();
    for (const c of certs) {
      const dt = (c.issuedAt as Timestamp)?.toDate?.();
      if (!dt || !c.courseId) continue;
      const prev = certByCourse.get(c.courseId);
      if (!prev || dt > prev.date) certByCourse.set(c.courseId, { date: dt, id: c.__id });
    }
    const extByCourse = new Map<string, ExternalRow>();
    // Aynı kurs için birden fazla dış kayıt olabiliyor; kazanan EN SON
    // tamamlanan olmalı. Eskiden döngüde en son gelen kazanıyordu, rastgeleydi.
    for (const e of externals) {
      if (!e.courseId) continue;
      const prev = extByCourse.get(e.courseId);
      const t = e.completedAt?.toMillis?.() ?? 0;
      if (!prev || t > (prev.completedAt?.toMillis?.() ?? 0)) extByCourse.set(e.courseId, e);
    }

    const relevant = courses.filter(
      (c) => requiredIds.has(c.id) || assignedIds.has(c.id) || certByCourse.has(c.id) || extByCourse.has(c.id)
    );

    return relevant.map((course) => {
      const ext = extByCourse.get(course.id) ?? null;
      const internalCert = certByCourse.get(course.id) ?? null;
      const internal = internalCert?.date ?? null;
      const extDate = ext?.completedAt?.toDate?.() ?? null;
      // En son alınan geçerli sayılır — iç ya da dış fark etmez.
      const useExt = !!extDate && (!internal || extDate > internal);
      const date = useExt ? extDate : internal;

      if (date) {
        const expires = useExt
          ? ext?.expiresAt?.toDate?.() ?? null
          : addValidity(date, course.recurrenceEvery, course.recurrenceUnit);
        return {
          course,
          required: requiredIds.has(course.id),
          state: "DONE" as const,
          date,
          expires,
          days: expires ? Math.round((expires.getTime() - Date.now()) / DAY) : null,
          external: useExt ? ext : null,
          certificateId: useExt ? null : internalCert?.id ?? null,
        };
      }
      return {
        course,
        required: requiredIds.has(course.id),
        state: assignedIds.has(course.id) ? ("PLANNED" as const) : ("MISSING" as const),
        date: null,
        expires: null,
        days: null,
        external: null,
        certificateId: null,
      };
    });
  }, [courses, requiredIds, assignments, certs, externals]);

  const missing = lines.filter((l) => l.state === "MISSING");
  const planned = lines.filter((l) => l.state === "PLANNED");
  const done = lines.filter((l) => l.state === "DONE");
  const expired = done.filter((l) => l.days !== null && l.days < 0);


  const canEdit =
    role === "ADMIN" || (role === "MANAGER" && user?.departmentId === profile?.departmentId);

  if (role !== "ADMIN" && role !== "MANAGER" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  if (!user)
    return (
      <div>
        <PageHead title="Staff" subtitle="Training status." />
        <p className="text-sm text-slate-400 py-10">
          {err ? err : "Loading…"}
        </p>
      </div>
    );

  const titleNames = (user.jobTitleIds ?? [])
    .map((id) => jobTitles.find((j) => j.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div>
      <Link to="/follow-up" className="text-xs text-slate-500 hover:text-slate-800 no-print">
        ← Training Follow-Up
      </Link>
      <PageHead title={user.name} subtitle="Training status, gaps and external certificates." />
      <div className="mb-4" />

      {/* Kimlik + özet */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] text-slate-500">{user.email}</div>
            <div className="text-[12px] text-slate-600 mt-1">
              {departments.get(user.departmentId ?? "") ?? "No department"}
              {titleNames.length > 0 && (
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {titleNames.map((t) => (
                    <span
                      key={t}
                      className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[11px] font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <PrintButton label="PDF Report" />
            {canEdit && (
              <button
                onClick={() => setDialog({ kind: "add", course: null })}
                className="btn-secondary text-xs py-2"
              >
                + External Certificate
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <Stat label="Completed" value={done.length - expired.length} cls="bg-emerald-50 text-emerald-800" />
          <Stat label="Planned" value={planned.length} cls="bg-sky-50 text-sky-800" />
          <Stat label="Missing" value={missing.length} cls="bg-slate-100 text-slate-700" />
          <Stat label="Expired" value={expired.length} cls="bg-red-50 text-red-800" />
        </div>
      </div>

      {/* Eğitim durumu */}
      <div className="card">
        <div
          className="px-5 py-3 relative"
          style={{ background: "linear-gradient(180deg,#8b1013 0%,#6d0d11 100%)" }}
        >
          <div className="text-[13px] font-bold text-white">
            Training <span className="text-white/60 font-normal">({lines.length})</span>
          </div>
          <span
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="th w-10">#</th>
                <th className="th">Training</th>
                <th className="th">Required</th>
                <th className="th">Status</th>
                <th className="th">Completed</th>
                <th className="th">Valid Until</th>
                <th className="th">Source</th>
                <th className="th w-12 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    No training linked to this person yet — assign a course or give them an authorisation scope
                    with required training.
                  </td>
                </tr>
              )}
              {[...missing, ...planned, ...done].map((l, i) => {
                const isExpired = l.days !== null && l.days < 0;
                return (
                  <tr key={l.course.id} className="hover:bg-slate-50/70">
                    <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="td font-semibold text-slate-900">{l.course.title}</td>
                    <td className="td">
                      {l.required ? (
                        <span className="text-[11px] font-semibold text-slate-600">Yes</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="td">
                      <StateBadge state={l.state} expired={isExpired} />
                    </td>
                    <td className="td tabular-nums text-slate-500">{fmt(l.date)}</td>
                    <td className="td tabular-nums">
                      {l.expires ? (
                        <span className={isExpired ? "text-brand-700 font-semibold" : "text-slate-600"}>
                          {fmt(l.expires)}
                          <span className="block text-[10px] text-slate-400">
                            {l.days! < 0 ? `${-l.days!}d overdue` : `${l.days}d left`}
                          </span>
                        </span>
                      ) : l.state === "DONE" ? (
                        <span className="text-slate-400 text-[11px]">no expiry</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="td">
                      {l.external ? (
                        // Belgesi olmayan (kâğıt) kayıtta link yerine düz metin.
                        l.external.fileUrl ? (
                          <a
                            href={l.external.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-700 hover:underline text-[12px]"
                            title={`Provider: ${l.external.provider}`}
                          >
                            External · {l.external.provider}
                          </a>
                        ) : (
                          <span
                            className="text-slate-500 text-[12px]"
                            title={`Provider: ${l.external.provider}`}
                          >
                            External · {l.external.provider}
                          </span>
                        )
                      ) : l.state === "DONE" && l.certificateId ? (
                        <Link
                          to={`/certificate/${l.certificateId}`}
                          className="text-brand-700 hover:underline text-[12px] font-medium"
                        >
                          BonAir · view certificate
                        </Link>
                      ) : l.state === "DONE" ? (
                        <span className="text-[12px] text-slate-500">BonAir</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="td text-right no-print">
                      {canEdit && (
                        <RowMenu
                          label={`Actions for ${l.course.title}`}
                          items={[
                            {
                              label: l.external ? "Replace external record" : "Add external certificate",
                              icon: "↑",
                              onClick: () => setDialog({ kind: "add", course: l.course }),
                            },
                            ...(l.external
                              ? [
                                  // Belge yoksa "Open document" boş sekme açıyordu.
                                  ...(l.external.fileUrl
                                    ? [
                                        {
                                          label: "Open document",
                                          icon: "↗",
                                          onClick: () =>
                                            window.open(
                                              l.external!.fileUrl,
                                              "_blank",
                                              "noreferrer"
                                            ),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: "Delete external record",
                                    icon: "🗑",
                                    danger: true,
                                    onClick: () => setDialog({ kind: "remove", row: l.external! }),
                                  },
                                ]
                              : []),
                            // İçerik açılmadığı için kilitli kalan atamayı
                            // admin gerekçeyle kapatabilir. Sınavı olan kurs
                            // bu yolla kapanmaz — Function reddeder.
                            ...(role === "ADMIN" && l.state === "PLANNED"
                              ? [
                                  {
                                    label: "Mark as completed (admin)",
                                    icon: "✓",
                                    onClick: () => setDialog({ kind: "force", line: l }),
                                  },
                                ]
                              : []),
                          ]}
                        />
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

      {/* TÜM dış kayıtlar. Eğitim tablosu kurs başına yalnızca kazanan kaydı
          gösteriyor; aynı kursa girilmiş ikinci bir kayıt hiçbir yerde
          görünmüyor, dolayısıyla silinemiyordu. Burası tam liste. */}
      <div className="card mt-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold text-slate-800">
            External Certificates{" "}
            <span className="text-slate-400 font-normal">({externals.length})</span>
          </span>
          {canEdit && (
            <button
              onClick={() => setDialog({ kind: "add", course: null })}
              className="btn-secondary text-xs py-1.5 no-print"
            >
              + Add
            </button>
          )}
        </div>

        {externals.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-slate-400">
            No external certificates recorded for {user.name}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="th">Training</th>
                  <th className="th">Counts As</th>
                  <th className="th">Provider</th>
                  <th className="th">Completed</th>
                  <th className="th">Valid Until</th>
                  <th className="th">Document</th>
                  {canEdit && <th className="th w-12 text-right no-print">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...externals]
                  .sort(
                    (a, b) =>
                      (b.completedAt?.toMillis?.() ?? 0) - (a.completedAt?.toMillis?.() ?? 0)
                  )
                  .map((e) => {
                    const exp = e.expiresAt?.toDate?.() ?? null;
                    const expired = !!exp && exp.getTime() < Date.now();
                    const linked = courses.find((c) => c.id === e.courseId);
                    return (
                      <tr key={e.id} className="hover:bg-slate-50/70">
                        <td className="td font-semibold text-slate-900">
                          {e.title}
                          {e.method && (
                            <span className="ml-1.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10.5px] font-medium">
                              {e.method}
                            </span>
                          )}
                        </td>
                        <td className="td">
                          {linked ? (
                            <span className="text-slate-700">{linked.title}</span>
                          ) : (
                            <span className="text-amber-700 text-[11px] font-medium">
                              Not linked — closes no gap
                            </span>
                          )}
                        </td>
                        <td className="td text-slate-600">{e.provider}</td>
                        <td className="td tabular-nums text-slate-500">
                          {fmt(e.completedAt?.toDate?.())}
                        </td>
                        <td className="td tabular-nums">
                          <span className={expired ? "text-brand-700 font-semibold" : "text-slate-700"}>
                            {exp ? fmt(exp) : "—"}
                          </span>
                          {expired && (
                            <span className="ml-2 text-[10px] font-semibold text-brand-700">
                              EXPIRED
                            </span>
                          )}
                        </td>
                        {/* Kâğıttan aktarılan kayıtların dijital kopyası yok;
                            koşulsuz "Open" linki ölü bağlantı basıyordu. */}
                        <td className="td">
                          {e.fileUrl ? (
                            <a
                              href={e.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[12px] text-brand-700 hover:underline"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-400">On paper</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="td text-right no-print">
                            <RowMenu
                              label={`Actions for ${e.title}`}
                              items={[
                                {
                                  label: "Edit",
                                  icon: "✎",
                                  onClick: () => setDialog({ kind: "edit", row: e }),
                                },
                                {
                                  label: "Delete",
                                  icon: "🗑",
                                  danger: true,
                                  onClick: () => setDialog({ kind: "remove", row: e }),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}

      {dialog?.kind === "add" && (
        <Modal
          title="External Certificate"
          subtitle={`${user.name}${dialog.course ? ` · ${dialog.course.title}` : ""}`}
          onClose={() => setDialog(null)}
        >
          <ExternalCertForm
            user={{ id: user.id, name: user.name, departmentId: user.departmentId }}
            course={dialog.course}
            courses={courses}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "edit" && (
        <Modal
          title="Edit External Certificate"
          subtitle={`${user.name} · ${dialog.row.title}`}
          onClose={() => setDialog(null)}
        >
          <ExternalCertForm
            user={{ id: user.id, name: user.name, departmentId: user.departmentId }}
            course={null}
            courses={courses}
            existing={dialog.row as any}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "remove" && (
        <Modal title="Delete Record" subtitle={dialog.row.title} onClose={() => setDialog(null)} width="max-w-md">
          <p className="text-sm text-slate-700 mb-2">
            Delete this external training record? The person will be shown as missing this training
            again.
          </p>
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={async () => {
                await deleteDoc(doc(db, "externalTrainings", dialog.row.id));
                setToast("Record deleted.");
                setDialog(null);
              }}
              className="btn-primary text-xs py-2"
            >
              Delete Record
            </button>
            <button onClick={() => setDialog(null)} className="btn-secondary text-xs py-2">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "force" && (
        <Modal
          title="Mark as Completed"
          subtitle={`${user.name} · ${dialog.line.course.title}`}
          onClose={() => setDialog(null)}
          width="max-w-lg"
        >
          <ForceCompleteForm
            userId={user.id}
            courseId={dialog.line.course.id}
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

/**
 * İçerik açılmadığı için kilitli kalan atamayı admin elle kapatır.
 * Gerekçe zorunlu — belge bir uygunluk kaydı, kimin neden kapattığı yazmalı.
 * Sınavı olan ve geçilmemiş kursu Function reddeder.
 */
function ForceCompleteForm({
  userId,
  courseId,
  onDone,
  onCancel,
}: {
  userId: string;
  courseId: string;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    setBusy(true);
    setErr(null);
    try {
      await httpsCallable(functions, "forceCompleteAssignment")({
        assignmentId: `${userId}_${courseId}`,
        reason: reason.trim(),
      });
      onDone("Marked as completed. Certificate issued.");
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-[12px] text-slate-600 mb-3">
        Use this only when the person completed the training but the system could not record it —
        for example the content would not load. A certificate is issued and the reason below is
        stored on both the assignment and the certificate.
      </p>
      <label className="label">Reason *</label>
      <textarea
        className="input"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Content file failed to load on 26.08.2026; training delivered in the classroom and attendance verified."
        autoFocus
      />
      <p className="text-[10px] text-slate-500 mt-1">
        If the course has an exam that has not been passed, this will be refused — exam results
        cannot be entered by hand.
      </p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={busy || reason.trim().length < 5}
          className="btn-primary text-xs py-2"
        >
          {busy ? "Saving…" : "Mark Completed"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${cls}`}>
      <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[11px] font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function StateBadge({ state, expired }: { state: Line["state"]; expired: boolean }) {
  if (state === "DONE")
    return expired ? (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-red-50 text-red-700 ring-red-200">
        Expired
      </span>
    ) : (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">
        Completed
      </span>
    );
  if (state === "PLANNED")
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-sky-50 text-sky-700 ring-sky-200">
        Planned
      </span>
    );
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-slate-100 text-slate-600 ring-slate-200">
      Missing
    </span>
  );
}
