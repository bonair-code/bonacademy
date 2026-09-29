import { PageHead } from "../components/PageHead";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { CertificateSheet, fmtTs, type Cert } from "../components/CertificateSheet";
import { printCertificate } from "../lib/print";

/** issuedAt + geçerlilik süresi = yenileme tarihi. Süre yoksa null. */
function renewalDate(
  issuedAt: Timestamp | null | undefined,
  every: number | null,
  unit: string
): Date | null {
  const base = issuedAt?.toDate?.();
  if (!base || !every || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

/** "1 yr 3 mo left" / "42 days left" / "Expired 12 days ago" */
function remainingText(due: Date): string {
  const days = Math.round((due.getTime() - Date.now()) / 86400000);
  if (days < 0) {
    const past = Math.abs(days);
    return past === 0 ? "Expires today" : `Expired ${past} day${past === 1 ? "" : "s"} ago`;
  }
  if (days === 0) return "Expires today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} left`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} left`;

  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0
    ? `${years} year${years === 1 ? "" : "s"} left`
    : `${years} yr ${rem} mo left`;
}

export function Certificates() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Cert[]>([]);
  const [view, setView] = useState<Cert | null>(null);
  // Yenileme tarihi kursun geçerlilik süresinden (recurrence) hesaplanır.
  const [courses, setCourses] = useState<Map<string, { every: number | null; unit: string }>>(
    new Map()
  );

  useEffect(() => {
    if (!profile) return;
    return onSnapshot(
      query(collection(db, "certificates"), where("userId", "==", profile.uid)),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Cert, "id">) })))
    );
  }, [profile]);

  useEffect(() => {
    return onSnapshot(collection(db, "courses"), (snap) =>
      setCourses(
        new Map(
          snap.docs.map((d) => {
            const x = d.data() as any;
            return [d.id, { every: x.recurrenceEvery ?? null, unit: x.recurrenceUnit ?? "NONE" }];
          })
        )
      )
    );
  }, []);

  // En yeni sertifika üstte.
  const sorted = [...rows].sort(
    (a, b) => (b.issuedAt?.toMillis?.() ?? 0) - (a.issuedAt?.toMillis?.() ?? 0)
  );

  return (
    <div>
      <PageHead
        title="My Certificates"
        subtitle="Certificates for the training you completed."
      />
      <div className="card">
        <div
          className="px-5 py-3 relative"
          style={{ background: "linear-gradient(180deg,#8b1013 0%,#6d0d11 100%)" }}
        >
          <div className="text-[13px] font-bold text-white">
            Certificates <span className="text-white/60 font-normal">({sorted.length})</span>
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
                <th className="th">Certificate No</th>
                <th className="th">Training</th>
                <th className="th">Issued</th>
                <th className="th">Valid Until</th>
                <th className="th">Status</th>
                <th className="th w-12 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    You have no certificates yet.
                  </td>
                </tr>
              )}
              {sorted.map((c, i) => {
                const r = courses.get((c as any).courseId);
                const due = renewalDate(c.issuedAt, r?.every ?? null, r?.unit ?? "NONE");
                const expired = !!due && due.getTime() < Date.now();
                // Son 60 gün: yenilemeyi planlamak için erken uyarı.
                const expiringSoon =
                  !!due && !expired && due.getTime() - Date.now() < 60 * 24 * 3600 * 1000;
                return (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="td font-semibold text-slate-900 tabular-nums">{c.serialNo}</td>
                    <td className="td text-slate-700">{c.courseTitle}</td>
                    <td className="td tabular-nums text-slate-500">{fmtTs(c.issuedAt)}</td>
                    <td className="td tabular-nums">
                      <div
                        className={expired ? "text-brand-700 font-semibold" : "text-slate-700"}
                      >
                        {due ? due.toLocaleDateString("tr-TR") : "—"}
                      </div>
                      {due && (
                        <div
                          className={`text-[11px] ${
                            expired
                              ? "text-brand-700"
                              : expiringSoon
                              ? "text-amber-700 font-medium"
                              : "text-slate-400"
                          }`}
                        >
                          {remainingText(due)}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 ${
                          expired
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : expiringSoon
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        }`}
                      >
                        {expired ? "Expired" : expiringSoon ? "Expiring soon" : "Valid"}
                      </span>
                      {!due && (
                        <span className="ml-2 text-[11px] text-slate-400">No renewal</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <button
                        onClick={() => setView(c)}
                        className="btn-primary text-xs py-1 px-3"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ExternalRecords />

      {view && <CertModal cert={view} onClose={() => setView(null)} />}
    </div>
  );
}

type ExternalRow = {
  id: string;
  title: string;
  provider: string;
  completedAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
  fileUrl?: string;
  externalSerialNo?: string | null;
};

/**
 * Dışarıdan alınmış eğitimler. BonAir sertifikası üretilmez — kişinin getirdiği
 * belge saklanır. Training History sayfası kaldırıldığı için personelin kendi
 * dış kayıtlarını görebileceği tek yer burası.
 */
function ExternalRecords() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ExternalRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    return onSnapshot(
      query(collection(db, "externalTrainings"), where("userId", "==", profile.uid)),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {}
    );
  }, [profile]);

  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) => (b.completedAt?.toMillis?.() ?? 0) - (a.completedAt?.toMillis?.() ?? 0)
  );

  return (
    <div className="card mt-4">
      <div
        className="px-5 py-3 relative"
        style={{ background: "linear-gradient(180deg,#8b1013 0%,#6d0d11 100%)" }}
      >
        <div className="text-[13px] font-bold text-white">
          External Training <span className="text-white/60 font-normal">({sorted.length})</span>
        </div>
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
        />
      </div>
      <p className="px-5 py-2 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50">
        Training you obtained outside BonAir. The certificate on file is the one you provided.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="th w-10">#</th>
              <th className="th">Training</th>
              <th className="th">Provider</th>
              <th className="th">Their Certificate No</th>
              <th className="th">Completed</th>
              <th className="th">Valid Until</th>
              <th className="th w-24 text-right no-print">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r, i) => {
              const exp = r.expiresAt?.toDate?.() ?? null;
              const expired = !!exp && exp.getTime() < Date.now();
              return (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="td font-semibold text-slate-900">{r.title}</td>
                  <td className="td text-slate-600">{r.provider}</td>
                  <td className="td tabular-nums text-slate-500">
                    {r.externalSerialNo || "—"}
                  </td>
                  <td className="td tabular-nums text-slate-500">{fmtTs(r.completedAt)}</td>
                  <td className="td tabular-nums">
                    <span className={expired ? "text-brand-700 font-semibold" : "text-slate-700"}>
                      {exp ? exp.toLocaleDateString("tr-TR") : "—"}
                    </span>
                    {expired && (
                      <span className="ml-2 text-[10px] font-semibold text-brand-700">EXPIRED</span>
                    )}
                  </td>
                  <td className="td text-right no-print">
                    {/* Kâğıttan aktarılan kayıtların dijital kopyası yok. */}
                    {r.fileUrl ? (
                      <a
                        href={r.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary text-xs py-1 px-3"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-[11px] text-slate-400">On paper</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CertModal({ cert, onClose }: { cert: Cert; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-xl overflow-hidden shadow-2xl">
          <CertificateSheet cert={cert} />
        </div>
        <div className="flex justify-center gap-3 mt-4 no-print">
          <button onClick={printCertificate} className="btn-primary">
            Print / PDF (landscape)
          </button>
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
