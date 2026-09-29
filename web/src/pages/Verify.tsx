import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ORG } from "../lib/org";

type CertV = {
  serialNo: string;
  name: string;
  courseTitle: string;
  issuedAt?: Timestamp | null;
};

const dmy = (d?: Date | null) => (d ? d.toLocaleDateString("tr-TR") : "");
/** YYYY-MM-DD ile Date'i gün hassasiyetinde karşılaştırır. */
function sameDay(d: Date, iso: string) {
  const [y, m, day] = iso.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

/**
 * Herkese açık sertifika doğrulama. QR doğrudan seri numarasına gider; denetçi
 * ayrıca sertifika tarihini girerek belgenin elindekiyle aynı olduğunu teyit eder.
 */
export function Verify() {
  const { serialNo: fromUrl } = useParams<{ serialNo: string }>();
  const [serial, setSerial] = useState(fromUrl ?? "");
  const [date, setDate] = useState("");
  const [cert, setCert] = useState<CertV | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "found" | "none">(
    fromUrl ? "loading" : "idle"
  );
  const [checked, setChecked] = useState<null | boolean>(null);

  async function lookup(no: string) {
    const key = no.trim();
    if (!key) return;
    setState("loading");
    setChecked(null);
    try {
      const s = await getDoc(doc(db, "certVerify", key));
      if (s.exists()) {
        setCert(s.data() as CertV);
        setState("found");
      } else {
        setCert(null);
        setState("none");
      }
    } catch {
      setCert(null);
      setState("none");
    }
  }

  useEffect(() => {
    if (fromUrl) lookup(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl]);

  const issued = cert?.issuedAt?.toDate?.() ?? null;

  function confirmDate(e: React.FormEvent) {
    e.preventDefault();
    if (!issued || !date) return;
    setChecked(sameDay(issued, date));
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg,#8b1013 0%,#5c0a0d 100%)" }}
    >
      <div className="w-full max-w-[440px]">
        <div className="flex flex-col items-center mb-5">
          <div className="bg-white rounded-2xl px-8 py-5 shadow-lg">
            <img src="/Logo.png" alt="Bon Air" className="h-11 w-auto" />
          </div>
          <p className="text-white/60 text-[11px] tracking-[0.16em] uppercase mt-4">
            Certificate Verification
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
          <span
            className="block h-1"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />
          <div className="px-7 py-6">
            {/* Seri no arama */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookup(serial);
              }}
              className="mb-4"
            >
              <label className="label">Certificate No</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="BA-00001 or 25-131"
                  autoFocus={!fromUrl}
                />
                <button type="submit" className="btn-primary text-xs px-4 shrink-0">
                  Check
                </button>
              </div>
            </form>

            {state === "loading" && <p className="text-sm text-slate-400">Checking…</p>}

            {state === "none" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="text-red-700 font-bold text-[15px]">Not a valid certificate</div>
                <p className="text-xs text-red-700/80 mt-1">
                  No certificate is registered under this number.
                </p>
              </div>
            )}

            {state === "found" && cert && (
              <>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-emerald-700 font-bold text-[15px]">
                    ✓ Registered certificate
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-2">{cert.name}</div>
                  <p className="text-sm text-slate-600">{cert.courseTitle}</p>
                  <div className="text-[11px] text-slate-500 mt-2 tabular-nums">
                    No: {cert.serialNo}
                    {issued ? ` · Issued ${dmy(issued)}` : ""}
                  </div>
                </div>

                {/* Tarih teyidi — elindeki belgeyle aynı mı */}
                <form onSubmit={confirmDate} className="mt-4 pt-4 border-t border-slate-100">
                  <label className="label">Confirm the date on the document</label>
                  <div className="flex gap-2">
                    <input
                      className="input"
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setChecked(null);
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!date}
                      className="btn-secondary text-xs px-4 shrink-0 disabled:opacity-40"
                    >
                      Verify
                    </button>
                  </div>

                  {checked === true && (
                    <p className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] font-semibold px-3 py-2">
                      Verified — the number and date match our records.
                    </p>
                  )}
                  {checked === false && (
                    <p className="mt-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold px-3 py-2">
                      Date does not match. This number was issued on {dmy(issued)}.
                    </p>
                  )}
                  {checked === null && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Enter the certificate date printed on the document.
                    </p>
                  )}
                </form>
              </>
            )}

            {state === "idle" && (
              <p className="text-xs text-slate-500">
                Enter the certificate number, or scan the QR code on the document.
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-white/40 text-[11px] mt-5">{ORG.legalFooter}</p>
      </div>
    </div>
  );
}
