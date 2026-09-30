import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, onSnapshot } from "firebase/firestore";
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
  // Önce YIL, sonra sıra numarası. Eskiden yalnızca sondaki rakamlar
  // alınıyordu; 25-131 ile 26-001 karşılaştırılınca 131 > 1 çıkıyor ve yeni
  // yılın ilk sertifikası listenin en altına düşüyordu.
  const m = String(s).match(/^\s*(\d{2})\s*-\s*(\d+)/);
  if (m) return Number(m[1]) * 1_000_000 + Number(m[2]);
  const only = String(s).match(/(\d+)\s*$/);
  return only ? Number(only[1]) : 0;
}

/** Sıralanabilir kolonlar. */
type SortBy = "serial" | "name" | "birthPlace" | "birthDate" | "course" | "instructor" | "duration" | "date";
type Sort = { by: SortBy; dir: "asc" | "desc" };

const txt = (s?: string | null) => (s ?? "").toLocaleLowerCase("tr");
const ms = (t?: Timestamp | null) => t?.toMillis?.() ?? 0;

/** İki kaydı seçilen kolona göre karşılaştırır. */
function cmp(a: Cert, b: Cert, by: SortBy): number {
  switch (by) {
    case "serial":
      return serialKey(a.serialNo) - serialKey(b.serialNo);
    case "name":
      return txt(a.userName).localeCompare(txt(b.userName), "tr");
    case "birthPlace":
      return txt(a.birthPlace).localeCompare(txt(b.birthPlace), "tr");
    case "birthDate":
      return (a.birthDate ?? "").localeCompare(b.birthDate ?? "");
    case "course":
      return txt(a.courseTitle).localeCompare(txt(b.courseTitle), "tr");
    case "instructor":
      return txt(a.instructorName).localeCompare(txt(b.instructorName), "tr");
    case "duration":
      return (a.durationHours ?? -1) - (b.durationHours ?? -1);
    case "date":
      return ms(a.issuedAt) - ms(b.issuedAt);
  }
}

/**
 * Sıralanabilir başlık. Aynı kolona tekrar tıklamak yönü çevirir; yeni bir
 * kolona geçince metin kolonları A→Z, sayı ve tarih kolonları büyükten
 * küçüğe başlar — her birinde beklenen ilk sonuç bu.
 */
function SortTh({
  by,
  sort,
  onSort,
  children,
}: {
  by: SortBy;
  sort: Sort;
  onSort: (s: Sort) => void;
  children: React.ReactNode;
}) {
  const on = sort.by === by;
  const numeric = by === "serial" || by === "duration" || by === "date" || by === "birthDate";
  return (
    <th className="th">
      <button
        type="button"
        onClick={() =>
          onSort(
            on
              ? { by, dir: sort.dir === "asc" ? "desc" : "asc" }
              : { by, dir: numeric ? "desc" : "asc" }
          )
        }
        className={`inline-flex items-center gap-1 hover:text-slate-800 ${
          on ? "text-slate-800 font-semibold" : ""
        }`}
      >
        {children}
        <span className={`text-[9px] leading-none ${on ? "opacity-90" : "opacity-25"}`}>
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "▼"}
        </span>
      </button>
    </th>
  );
}

export function CertificateRegister() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  // Varsayılan: en yeni numara üstte.
  const [sort, setSort] = useState<Sort>({ by: "serial", dir: "desc" });
  const [numbering, setNumbering] = useState<{ prefix: string; next: number; pad: number } | null>(
    null
  );
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
      // Ön ek yıldır ve sayaç yıl başında sıfırlanır; kayıtlı yıl geçmişse
      // sıradaki numara yine 1.
      const yy = String(new Date().getFullYear()).slice(-2);
      const sameYear = String(x.year ?? "") === yy;
      setNumbering({
        prefix: yy,
        next: sameYear ? Number(x.next ?? 1) || 1 : 1,
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
      .sort((a, b) => {
        const dir = sort.dir === "asc" ? 1 : -1;
        return cmp(a, b, sort.by) * dir;
      });
  }, [rows, q, source, sort]);

  if (role !== "ADMIN" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  const preview = numbering
    ? `${numbering.prefix}-${String(numbering.next).padStart(numbering.pad, "0")}`
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
          {/* Numara elle verilmiyor: ön ek yıldır ve seri her yıl başında
              kendiliğinden birden başlar. */}
          <span
            className="text-[11px] text-slate-500"
            title="The prefix is the year; the series restarts at 001 each January."
          >
            Next number: <b className="text-slate-800 tabular-nums">{preview}</b>{" "}
            <span className="text-slate-400">· automatic</span>
          </span>
          {role === "ADMIN" && (
            <>
              <button
                onClick={() => setImporting(true)}
                className="btn-secondary text-xs py-1.5 no-print"
              >
                ↑ Import past certificates
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
                <SortTh by="serial" sort={sort} onSort={setSort}>
                  Certificate No
                </SortTh>
                <SortTh by="name" sort={sort} onSort={setSort}>
                  Name &amp; Surname
                </SortTh>
                <SortTh by="birthPlace" sort={sort} onSort={setSort}>
                  Birth Place
                </SortTh>
                <SortTh by="birthDate" sort={sort} onSort={setSort}>
                  Birth Date
                </SortTh>
                <SortTh by="course" sort={sort} onSort={setSort}>
                  Training
                </SortTh>
                <SortTh by="instructor" sort={sort} onSort={setSort}>
                  Instructor
                </SortTh>
                <SortTh by="duration" sort={sort} onSort={setSort}>
                  Duration
                </SortTh>
                <SortTh by="date" sort={sort} onSort={setSort}>
                  Certificate Date
                </SortTh>
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

