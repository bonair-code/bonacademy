import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { PageHead } from "../components/PageHead";
import { CertificateSheet, fmtTs, type Cert } from "../components/CertificateSheet";
import { printCertificate } from "../lib/print";

/** Tek sertifikayı tam sayfa gösterir — personel raporundan link ile gelinir. */
export function CertificateView() {
  const { certId } = useParams<{ certId: string }>();
  const [cert, setCert] = useState<Cert | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!certId) return;
    return onSnapshot(
      doc(db, "certificates", certId),
      (d) => setCert(d.exists() ? ({ id: d.id, ...(d.data() as any) }) : null),
      (e) => setErr(e.message)
    );
  }, [certId]);

  return (
    <div>
      <button
        onClick={() => history.back()}
        className="text-xs text-slate-500 hover:text-slate-800 no-print"
      >
        ← Back
      </button>
      <PageHead title="Certificate" subtitle={cert?.courseTitle ?? ""} />
      <div className="mb-4" />

      {!cert ? (
        <p className="text-sm text-slate-400 py-10">{err ?? "Loading…"}</p>
      ) : cert.issuedVia === "IMPORT" ? (
        // Kâğıt sicilden aktarılan kayıt. Sistem bunun için BELGE ÜRETMEZ —
        // aslı kurumda; burada yalnızca sicil kaydı görünür. Aksi hâlde aynı
        // eğitim için ikinci bir "asıl" belge ortaya çıkardı.
        <ImportedRecord cert={cert} />
      ) : (
        <>
          {/* Telefonda sertifika küçültülmez, kaydırılır: 343px'e sığdırınca
              künye yazısı 3px'e iniyor ve belge okunmuyor. */}
          <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
          <div className="rounded-xl overflow-hidden shadow-card max-w-5xl min-w-[640px] lg:min-w-0">
            <CertificateSheet cert={cert} />
          </div>
          </div>
          <div className="flex gap-3 mt-4 no-print">
            <button onClick={printCertificate} className="btn-primary text-xs py-2">
              Print / PDF (landscape)
            </button>
            <Link to={`/verify/${encodeURIComponent(cert.verifyToken ?? "")}`} className="btn-secondary text-xs py-2">
              Open verification page
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * İçe aktarılmış (kâğıt) sertifikanın sicil kaydı. Belge basılmaz; kullanıcı
 * ne yazdırma ne de "asıl gibi" bir görüntü alır — sadece kaydın kendisi.
 */
function ImportedRecord({ cert }: { cert: Cert }) {
  const rows: [string, string][] = [
    ["Certificate No", cert.serialNo],
    ["Name & Surname", cert.userName],
    ["Place & Date of Birth", [cert.birthPlace, fmtISODate(cert.birthDate)].filter(Boolean).join(" & ") || "—"],
    ["Training", cert.courseTitle],
    ["Instructor", cert.instructorName || "—"],
    ["Duration", cert.durationHours != null ? `${cert.durationHours} Hours` : "—"],
    ["Location", cert.heldIn || "—"],
    ["Certificate Date", fmtTs(cert.issuedAt)],
  ];
  return (
    <div className="max-w-3xl">
      <p className="text-[12px] text-slate-700 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 mb-3">
        <b>Register record only.</b> This training was certified on paper before BonAcademy. The
        original certificate is held by the organisation — the system does not reproduce it.
      </p>
      <div className="card">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-slate-100">
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th className="th w-56 text-slate-500">{k}</th>
                <td className="td text-slate-900 font-medium">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 mt-4 no-print">
        <Link
          to={`/verify/${encodeURIComponent(cert.verifyToken ?? "")}`}
          className="btn-secondary text-xs py-2"
        >
          Open verification page
        </Link>
      </div>
    </div>
  );
}

/** YYYY-MM-DD → DD.MM.YYYY */
function fmtISODate(d?: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}
