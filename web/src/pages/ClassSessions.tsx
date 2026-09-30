import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import QRCode from "qrcode";
import { db, functions } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";

type Session = {
  id: string;
  courseId: string | null;
  courseTitle: string;
  instructorName: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  durationHours: number | null;
  /** Kapanışta atanan numara aralığı — oturum açılırken girilmez. */
  certFirstNo?: string | null;
  certLastNo?: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED";
  issuedCount?: number;
  createdAt?: Timestamp | null;
};
type Attendee = {
  id: string;
  fullName: string;
  birthPlace?: string | null;
  birthDate?: string | null;
  email?: string | null;
  userId?: string | null;
  certificateNo?: string | null;
  signedAt?: Timestamp | null;
};

const STATUS_CLS: Record<Session["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  OPEN: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-sky-50 text-sky-700 ring-sky-200",
};

const dmy = (d?: string | null) => (d ? d.split("-").reverse().join(".") : "—");

const MONTH_TR = [
  "Oca",
  "Şub",
  "Mar",
  "Nis",
  "May",
  "Haz",
  "Tem",
  "Ağu",
  "Eyl",
  "Eki",
  "Kas",
  "Ara",
];

/**
 * Oturum satırı. Sınıf eğitimi zamana bağlı bir iş, o yüzden liste değil ajanda:
 * solda tarih bloğu, ortada eğitim ve künyesi, sağda durum. Tabloda tarih
 * sütunun ortasında kaybolup gidiyordu.
 */
function SessionCard({
  s,
  onEdit,
  onDelete,
}: {
  s: Session;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const d = s.startDate ? new Date(`${s.startDate}T00:00:00`) : null;
  const multi = !!s.endDate && s.endDate !== s.startDate;

  return (
    <Link
      to={`/sessions/${s.id}`}
      className="card px-4 py-3 flex items-center gap-4 hover:bg-slate-50/70"
    >
      <div className="w-[52px] shrink-0 rounded-lg bg-slate-100 text-center py-1.5">
        <div className="text-[15px] font-bold leading-none tabular-nums text-slate-900">
          {d ? String(d.getDate()).padStart(2, "0") : "—"}
        </div>
        <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
          {d ? `${MONTH_TR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : ""}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-900 truncate">{s.courseTitle}</div>
        <div className="text-[11.5px] text-slate-500 truncate">
          {[
            multi ? `${dmy(s.startDate)} – ${dmy(s.endDate)}` : null,
            s.location || null,
            s.instructorName || null,
            s.durationHours != null ? `${s.durationHours} hours` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </div>

      <div className="hidden sm:block text-right shrink-0 w-[132px]">
        {s.status === "CLOSED" ? (
          <>
            <div className="text-[12px] font-semibold text-slate-800 tabular-nums">
              {s.issuedCount ?? 0} certificate{(s.issuedCount ?? 0) === 1 ? "" : "s"}
            </div>
            {s.certLastNo && (
              <div className="text-[10.5px] text-slate-400 tabular-nums">
                {s.certFirstNo ? `${s.certFirstNo}–${s.certLastNo}` : `no ${s.certLastNo}`}
              </div>
            )}
          </>
        ) : (
          <div className="text-[11.5px] text-slate-400">Not closed yet</div>
        )}
      </div>

      <span
        className={`shrink-0 text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded ring-1 ${
          STATUS_CLS[s.status]
        }`}
      >
        {s.status}
      </span>

      {/* Taslak oturum henüz belge üretmedi; düzeltilebilir ve silinebilir.
          Açılmış ya da kapanmış oturumda bu düğmeler yok — kapanmış oturumu
          silmek verilmiş sertifikaları sahipsiz bırakırdı. */}
      {s.status === "DRAFT" && (onEdit || onDelete) && (
        <span
          className="shrink-0 flex items-center gap-1.5 no-print"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {onEdit && (
            <button onClick={onEdit} className="btn-secondary text-[11px] py-1 px-2.5">
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="btn-secondary text-[11px] py-1 px-2.5 hover:text-brand-700"
            >
              Delete
            </button>
          )}
        </span>
      )}
    </Link>
  );
}

/* ─────────────── Liste ─────────────── */

export function ClassSessions() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Session[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string; durationHours?: number | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "edit"; row: Session } | { kind: "delete"; row: Session } | null
  >(null);
  const [err, setErr] = useState<string | null>(null);
  // Eğitmen kendi oturumunu da yönetebilir; ikisi de sınıf açıyor.
  const canManage = role === "ADMIN" || role === "INSTRUCTOR";

  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, "classSessions"), orderBy("createdAt", "desc")),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (e) => setErr(e.message)
    );
    const u2 = onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
      setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  if (role !== "ADMIN" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  return (
    <div>
      <PageHead
        title="Classroom Sessions"
        subtitle="Face-to-face training — QR attendance and certificates."
      />

      <div className="mb-4 flex justify-end">
        <button onClick={() => setOpen(true)} className="btn-primary text-xs py-2">
          + New Session
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">No sessions yet.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((s) => (
            <SessionCard
              key={s.id}
              s={s}
              onEdit={canManage ? () => setDialog({ kind: "edit", row: s }) : undefined}
              onDelete={canManage ? () => setDialog({ kind: "delete", row: s }) : undefined}
            />
          ))}
        </div>
      )}

      {err && <p className="text-xs text-brand-700 mt-3">{err}</p>}

      {open && (
        <Modal title="New Classroom Session" onClose={() => setOpen(false)}>
          <SessionForm courses={courses} onClose={() => setOpen(false)} />
        </Modal>
      )}

      {dialog?.kind === "edit" && (
        <Modal
          title="Edit Session"
          subtitle={dialog.row.courseTitle}
          onClose={() => setDialog(null)}
        >
          <SessionForm
            courses={courses}
            existing={dialog.row}
            onClose={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title="Delete Session" onClose={() => setDialog(null)} width="max-w-md">
          <DeleteSession row={dialog.row} onClose={() => setDialog(null)} />
        </Modal>
      )}
    </div>
  );
}

/**
 * Taslak oturumu siler. Katılımcı kayıtları da gider — oturum olmadan
 * anlamları kalmaz. Yalnızca DRAFT'ta çağrılır; açık ya da kapanmış oturumda
 * silme düğmesi hiç görünmez.
 */
function DeleteSession({ row, onClose }: { row: Session; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      const at = await getDocs(collection(db, "classSessions", row.id, "attendees"));
      await Promise.all(at.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "classSessions", row.id));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[13px] text-slate-700">
        Delete <b>{row.courseTitle}</b> ({dmy(row.startDate)})?
      </p>
      <p className="text-[11.5px] text-slate-500 mt-1.5">
        This session is still a draft — no certificate has been issued. Any attendance records
        collected so far are deleted with it.
      </p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button onClick={remove} disabled={busy} className="btn-primary text-xs py-2">
          {busy ? "Deleting…" : "Delete Session"}
        </button>
        <button onClick={onClose} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}

function SessionForm({
  courses,
  existing,
  onClose,
}: {
  courses: { id: string; title: string; durationHours?: number | null }[];
  /** Verilirse düzenleme kipi — yalnızca DRAFT oturumlarda açılır. */
  existing?: Session | null;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  // "OTHER": sistemde kursu olmayan bir eğitim; adı elle yazılır.
  const [courseId, setCourseId] = useState(
    existing ? (existing.courseId ?? "OTHER") : ""
  );
  const [otherTitle, setOtherTitle] = useState(
    existing && !existing.courseId ? existing.courseTitle : ""
  );
  const [instructorName, setInstructorName] = useState(
    existing?.instructorName ?? profile?.name ?? ""
  );
  const [location, setLocation] = useState(existing?.location ?? "İSTANBUL");
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [durationHours, setDurationHours] = useState(
    existing?.durationHours != null ? String(existing.durationHours) : ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const other = courseId === "OTHER";
  const course = other ? undefined : courses.find((c) => c.id === courseId);
  const title = other ? otherTitle.trim() : course?.title ?? "";
  const canSubmit = !!courseId && !!startDate && (!other || !!otherTitle.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        // Sistemde kursu olmayan eğitimde courseId boş kalır: sertifika yine
        // üretilir ama hiçbir kursun atamasını kapatmaz — kapatacak bir kurs
        // yok, uydurmak yanlış olurdu.
        courseId: other ? null : courseId,
        courseTitle: title,
        instructorName: instructorName.trim() || null,
        location: location.trim() || null,
        startDate,
        endDate: endDate || startDate,
        durationHours: durationHours ? Number(durationHours) : course?.durationHours ?? null,
      };
      if (existing) {
        await updateDoc(doc(db, "classSessions", existing.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "classSessions"), {
          ...payload,
          status: "DRAFT",
          createdById: profile?.uid ?? null,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Training</label>
          <select
            className="input"
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              const c = courses.find((x) => x.id === e.target.value);
              if (c?.durationHours) setDurationHours(String(c.durationHours));
            }}
          >
            <option value="">— Select —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="OTHER">Other — type the training name</option>
          </select>
          {other && (
            <>
              <input
                className="input mt-2"
                value={otherTitle}
                onChange={(e) => setOtherTitle(e.target.value)}
                placeholder="e.g. CL-604/605 PRE&POST FLIGHT TRAINING"
                autoFocus
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Not linked to a course — certificates are still issued, but no training
                assignment is closed.
              </p>
            </>
          )}
        </div>
        <div>
          <label className="label">Instructor</label>
          <input
            className="input"
            value={instructorName}
            onChange={(e) => setInstructorName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Location</label>
          <input
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="İSTANBUL"
          />
        </div>
        <div>
          <label className="label">Start Date</label>
          <input
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Finish Date</label>
          <input
            className="input"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Duration (hours)</label>
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
          />
        </div>
        {/* Sertifika numarası merkezî sicilden gelir — oturum başına ayrı
            numara girmek iki farklı seri üretiyordu. Bkz. Certificate
            Register → Numbering. */}
        <div className="sm:col-span-2">
          <p className="text-[11px] text-slate-500 rounded-md bg-slate-50 border border-slate-200 px-2.5 py-2">
            Certificate numbers are assigned automatically from the central register when you
            finish this class — nothing to enter here.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !canSubmit} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : existing ? "Save Changes" : "Create Session"}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

/* ─────────────── Detay ─────────────── */

export function ClassSessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { role } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [qr, setQr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const joinUrl = useMemo(
    () => (sessionId ? `${window.location.origin}/join/${sessionId}` : ""),
    [sessionId]
  );

  useEffect(() => {
    if (!sessionId) return;
    const u1 = onSnapshot(
      doc(db, "classSessions", sessionId),
      (d) => setSession(d.exists() ? ({ id: d.id, ...(d.data() as any) }) : null),
      (e) => setErr(e.message)
    );
    const u2 = onSnapshot(
      query(collection(db, "classSessions", sessionId, "attendees"), orderBy("signedAt")),
      (s) => setAttendees(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (e) => setErr(e.message)
    );
    return () => {
      u1();
      u2();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!joinUrl) return;
    QRCode.toDataURL(joinUrl, { width: 420, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [joinUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function setStatus(status: Session["status"]) {
    if (!sessionId) return;
    await updateDoc(doc(db, "classSessions", sessionId), { status });
    setToast(status === "OPEN" ? "Attendance is open." : "Attendance paused.");
  }

  async function finish() {
    if (!sessionId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await httpsCallable(functions, "finishClassSession")({ sessionId });
      const d = res.data as { issued: number; first: string; last: string };
      setToast(`${d.issued} certificate(s) issued — ${d.first} to ${d.last}.`);
      setConfirmFinish(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (role !== "ADMIN" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;
  if (!session)
    return (
      <div>
        <PageHead title="Session" subtitle="Classroom training." />
        <p className="text-sm text-slate-400 py-10">{err ?? "Loading…"}</p>
      </div>
    );

  const isOpen = session.status === "OPEN";
  const isClosed = session.status === "CLOSED";

  return (
    <div>
      <Link to="/sessions" className="text-xs text-slate-500 hover:text-slate-800">
        ← Classroom Sessions
      </Link>
      <PageHead title={session.courseTitle} subtitle="Attendance and certificates." />
      <div className="mb-4" />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* QR + kontrol */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span
              className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 ${STATUS_CLS[session.status]}`}
            >
              {session.status}
            </span>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {attendees.length} signed in
            </span>
          </div>

          <div ref={printRef} className="cert-print bg-white rounded-lg border border-slate-200 p-4 text-center">
            <div className="text-[12px] font-bold text-slate-900">{session.courseTitle}</div>
            <div className="text-[11px] text-slate-500 mb-3">
              {dmy(session.startDate)} · {session.location}
            </div>
            {qr ? (
              <img src={qr} alt="Attendance QR code" className="w-full h-auto" />
            ) : (
              <div className="py-10 text-xs text-slate-400">QR unavailable</div>
            )}
            <div className="text-[11px] text-slate-600 mt-3 font-semibold">
              Scan to sign the attendance list
            </div>
            <div className="text-[9px] text-slate-400 break-all mt-1">{joinUrl}</div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3 no-print">
            {!isClosed && (
              <button
                onClick={() => setStatus(isOpen ? "DRAFT" : "OPEN")}
                className={isOpen ? "btn-secondary text-xs py-1.5" : "btn-primary text-xs py-1.5"}
              >
                {isOpen ? "Pause attendance" : "Open attendance"}
              </button>
            )}
            <button onClick={() => window.print()} className="btn-secondary text-xs py-1.5">
              Print QR
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(joinUrl);
                setToast("Link copied.");
              }}
              className="btn-secondary text-xs py-1.5"
            >
              Copy link
            </button>
          </div>

          {!isClosed && (
            <button
              onClick={() => setConfirmFinish(true)}
              disabled={attendees.length === 0}
              className="btn-primary w-full text-xs py-2 mt-3 disabled:opacity-40 no-print"
            >
              Finish training &amp; issue certificates
            </button>
          )}
        </div>

        {/* Katılımcılar */}
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[13px] font-bold text-slate-900">
              Attendance <span className="text-slate-400 font-normal">({attendees.length})</span>
            </span>
            {isOpen && (
              <span className="text-[11px] text-emerald-700 font-semibold">Live — updates as people sign in</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="th w-10">#</th>
                  <th className="th">Name &amp; Surname</th>
                  <th className="th">Birth Place</th>
                  <th className="th">Birth Date</th>
                  <th className="th">Staff</th>
                  <th className="th">Certificate</th>
                  {!isClosed && <th className="th w-12 text-right no-print">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendees.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      {isOpen
                        ? "Waiting for people to scan the QR code…"
                        : "Open attendance so people can sign in."}
                    </td>
                  </tr>
                )}
                {attendees.map((a, i) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="td font-semibold text-slate-900">{a.fullName}</td>
                    <td className="td text-slate-500">{a.birthPlace || "—"}</td>
                    <td className="td tabular-nums text-slate-500">{dmy(a.birthDate)}</td>
                    <td className="td">
                      {a.userId ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">
                          Matched
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">External</span>
                      )}
                    </td>
                    <td className="td tabular-nums font-semibold text-brand-700">
                      {a.certificateNo || "—"}
                    </td>
                    {!isClosed && (
                      <td className="td text-right">
                        <RowMenu
                          label={`Actions for ${a.fullName}`}
                          items={[
                            {
                              label: "Remove from list",
                              icon: "🗑",
                              danger: true,
                              onClick: () =>
                                deleteDoc(
                                  doc(db, "classSessions", sessionId!, "attendees", a.id)
                                ),
                            },
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {err && <p className="px-5 py-3 text-xs text-brand-700 border-t border-slate-100">{err}</p>}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}

      {confirmFinish && (
        <Modal title="Finish Training" subtitle={session.courseTitle} onClose={() => setConfirmFinish(false)} width="max-w-md">
          <p className="text-sm text-slate-700 mb-2">
            Issue certificates to <b>{attendees.length}</b> attendee(s)? Numbers are taken from the
            central register, continuing the existing series.
          </p>
          <p className="text-[11px] text-slate-500">
            Attendance closes and the list can no longer change. Staff who signed in with their work
            email also get this training marked complete.
          </p>
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
            <button onClick={finish} disabled={busy} className="btn-primary text-xs py-2">
              {busy ? "Issuing…" : "Finish & Issue"}
            </button>
            <button onClick={() => setConfirmFinish(false)} className="btn-secondary text-xs py-2">
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
