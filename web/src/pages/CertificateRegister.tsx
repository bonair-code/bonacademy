import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import { PrintButton } from "../components/PrintButton";
import { Modal } from "../components/Modal";
import { CertImport } from "../components/CertImport";

/**
 * Sertifika sicili — sistemin ürettiği BÜTÜN sertifikalar tek listede,
 * numara sırasıyla. Kâğıttaki sicil defterinin karşılığı; denetimde
 * "şu numara kime, hangi eğitim için, ne zaman verildi" sorusunun cevabı.
 *
 * Numara tek bir sayaçtan gelir (`counters/certificates`); online tamamlama
 * da sınıf eğitimi de aynı seriden alır.
 */

type Cert = {
  id: string;
  serialNo: string;
  userName: string;
  courseTitle: string;
  issuedAt?: Timestamp | null;
  durationHours?: number | null;
  instructorName?: string | null;
  birthPlace?: string | null;
  birthDate?: string | null;
  sessionId?: string | null;
  examRequired?: boolean;
  examScore?: number | null;
  issuedVia?: string | null;
};

const fmt = (t?: Timestamp | null) => t?.toDate?.().toLocaleDateString("tr-TR") ?? "—";
const dmy = (s?: string | null) => (s ? s.split("-").reverse().join(".") : "—");

/** "25-131" gibi numaraları sayısal olarak sıralar. */
function serialKey(s: string): number {
  const m = s.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

export function CertificateRegister() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [numbering, setNumbering] = useState<{ prefix: string; next: number; pad: number } | null>(
    null
  );
  const [editNo, setEditNo] = useState(false);
  const [importing, setImporting] = useState(false);
  const [courseTitles, setCourseTitles] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(
      collection(db, "certificates"),
      (s) => {
        setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    const u3 = onSnapshot(collection(db, "courses"), (s) =>
      setCourseTitles(s.docs.map((d) => String((d.data() as any).title ?? "")).filter(Boolean).sort())
    );
    const u2 = onSnapshot(doc(db, "counters", "certificates"), (d) => {
      const x = (d.data() as any) || {};
      setNumbering({
        prefix: x.prefix === undefined ? "BA" : String(x.prefix ?? ""),
        next: Number(x.next ?? (x.value ?? 0) + 1) || 1,
        pad: Number(x.pad) || 3,
      });
    });
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return rows
      .filter((c) =>
        source === "CLASS"
          ? !!c.sessionId && c.issuedVia !== "IMPORT"
          : source === "ONLINE"
          ? !c.sessionId && c.issuedVia !== "IMPORT"
          : source === "PAPER"
          ? c.issuedVia === "IMPORT"
          : true
      )
      .filter((c) =>
        needle
          ? `${c.serialNo} ${c.userName} ${c.courseTitle}`.toLocaleLowerCase("tr").includes(needle)
          : true
      )
      .sort((a, b) => serialKey(b.serialNo) - serialKey(a.serialNo));
  }, [rows, q, source]);

  if (role !== "ADMIN" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  const preview = numbering
    ? numbering.prefix
      ? `${numbering.prefix}-${String(numbering.next).padStart(numbering.pad, "0")}`
      : String(numbering.next)
    : "—";

  return (
    <div>
      <PageHead
        title="Certificate Register"
        subtitle="Every certificate the system has issued, newest number first."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, name or training…"
          className="input !w-64 !py-1.5 !text-xs no-print"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="input !w-auto !py-1.5 !text-xs no-print"
        >
          <option value="">All sources</option>
          <option value="ONLINE">Online training</option>
          <option value="CLASS">Face-to-face class</option>
          <option value="PAPER">Paper register (imported)</option>
        </select>
        {(q || source) && (
          <button
            onClick={() => {
              setQ("");
              setSource("");
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 no-print"
          >
            Clear
          </button>
        )}

        <span className="text-[12px] font-semibold text-slate-700 ml-1">
          {shown.length}
          {shown.length !== rows.length ? ` of ${rows.length}` : ""} certificate
          {rows.length === 1 ? "" : "s"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            Next number: <b className="text-slate-800 tabular-nums">{preview}</b>
          </span>
          {role === "ADMIN" && (
            <>
              <button
                onClick={() => setImporting(true)}
                className="btn-secondary text-xs py-1.5 no-print"
              >
                ↑ Import past certificates
              </button>
              <button onClick={() => setEditNo(true)} className="btn-secondary text-xs py-1.5 no-print">
                Numbering
              </button>
            </>
          )}
          <PrintButton landscape />
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="th">Certificate No</th>
                <th className="th">Name &amp; Surname</th>
                <th className="th">Birth Place</th>
                <th className="th">Birth Date</th>
                <th className="th">Training</th>
                <th className="th">Instructor</th>
                <th className="th">Duration</th>
                <th className="th">Certificate Date</th>
                <th className="th">Source</th>
                <th className="th w-16 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && shown.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    No certificates issued yet.
                  </td>
                </tr>
              )}
              {shown.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/70">
                  <td className="td font-semibold text-slate-900 tabular-nums">{c.serialNo}</td>
                  <td className="td text-slate-800">{c.userName}</td>
                  <td className="td text-slate-500">{c.birthPlace || "—"}</td>
                  <td className="td tabular-nums text-slate-500">{dmy(c.birthDate)}</td>
                  <td className="td text-slate-700">{c.courseTitle}</td>
                  <td className="td text-slate-500">{c.instructorName || "—"}</td>
                  <td className="td tabular-nums text-slate-500">
                    {c.durationHours != null ? `${c.durationHours} h` : "—"}
                  </td>
                  <td className="td tabular-nums text-slate-500">{fmt(c.issuedAt)}</td>
                  <td className="td">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        c.issuedVia === "IMPORT"
                          ? "bg-slate-100 text-slate-600"
                          : c.sessionId
                          ? "bg-sky-50 text-sky-700"
                          : c.issuedVia === "ADMIN_OVERRIDE"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {c.issuedVia === "IMPORT"
                        ? "Paper"
                        : c.sessionId
                        ? "Classroom"
                        : c.issuedVia === "ADMIN_OVERRIDE"
                        ? "Manual"
                        : "Online"}
                    </span>
                  </td>
                  <td className="td text-right no-print">
                    <Link to={`/certificate/${c.id}`} className="btn-secondary text-xs py-1 px-3">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {importing && (
        <Modal title="Import Past Certificates" onClose={() => setImporting(false)}>
          <CertImport
            courseTitles={courseTitles}
            onClose={() => setImporting(false)}
            onDone={(m) => setToast(m)}
          />
        </Modal>
      )}

      {editNo && numbering && (
        <Modal title="Certificate Numbering" onClose={() => setEditNo(false)} width="max-w-md">
          <NumberingForm
            value={numbering}
            onDone={(m) => {
              setToast(m);
              setEditNo(false);
            }}
            onCancel={() => setEditNo(false)}
          />
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Numaralandırma ayarı. Kâğıt sicilden devam edebilmek için sıradaki numara
 * elle verilebilir — sistem oradan devam eder.
 */
function NumberingForm({
  value,
  onDone,
  onCancel,
}: {
  value: { prefix: string; next: number; pad: number };
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [prefix, setPrefix] = useState(value.prefix);
  const [next, setNext] = useState(String(value.next));
  const [pad, setPad] = useState(String(value.pad));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const n = Number(next) || 1;
  const p = Number(pad) || 3;
  const preview = prefix ? `${prefix}-${String(n).padStart(p, "0")}` : String(n);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await setDoc(
        doc(db, "counters", "certificates"),
        { prefix: prefix.trim(), next: n, pad: p },
        { merge: true }
      );
      onDone(`Next certificate number set to ${preview}.`);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-[12px] text-slate-600 mb-3">
        Online completions and face-to-face classes both take their number from here, so the
        register stays in one unbroken series.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Prefix</label>
          <input
            className="input"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="25"
          />
        </div>
        <div>
          <label className="label">Next number</label>
          <input
            className="input tabular-nums"
            type="number"
            min={1}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Digits</label>
          <input
            className="input tabular-nums"
            type="number"
            min={1}
            max={8}
            value={pad}
            onChange={(e) => setPad(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[12px] text-slate-700 mt-3 rounded-md bg-slate-50 border border-slate-200 px-2.5 py-2">
        Next certificate will be <b className="tabular-nums">{preview}</b>. Leave the prefix blank
        for plain numbers.
      </p>
      <p className="text-[10px] text-amber-700 mt-2">
        Numbers already issued are not changed. Setting this backwards can produce duplicates.
      </p>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}
