import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { PublicShell, pubInput, pubLabel } from "../components/PublicShell";
import { db } from "../lib/firebase";

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
    <PublicShell
      title="Certificate verification"
      subtitle="Check a certificate number against the register."
      width="max-w-[440px]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(serial);
        }}
      >
        <label className={pubLabel}>Certificate No</label>
        <div className="flex gap-2">
          <input
            className={pubInput}
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="26-001"
            autoFocus={!fromUrl}
          />
          <button
            type="submit"
            className="shrink-0 rounded-[10px] px-4 text-[13px] font-semibold text-white bg-brand-600 hover:bg-brand-700 transition"
          >
            Check
          </button>
        </div>
      </form>

      {state === "loading" && (
        <p className="text-[13px] mt-4" style={{ color: "#98989d" }}>
          Checking…
        </p>
      )}

      {state === "none" && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{ background: "rgba(224,51,44,.16)", border: "1px solid rgba(224,51,44,.35)" }}
        >
          <div className="font-semibold text-[14px]" style={{ color: "#ffb4b1" }}>
            Not a valid certificate
          </div>
          <p className="text-[12px] mt-1" style={{ color: "rgba(255,180,177,.8)" }}>
            No certificate is registered under this number.
          </p>
        </div>
      )}

      {state === "found" && cert && (
        <>
          <div
            className="mt-4 rounded-xl p-4"
            style={{ background: "rgba(48,177,90,.14)", border: "1px solid rgba(48,177,90,.32)" }}
          >
            <div className="font-semibold text-[13px]" style={{ color: "#86e0a6" }}>
              ✓ Registered certificate
            </div>
            <div className="text-[17px] font-semibold text-white mt-2 tracking-[-0.018em]">
              {cert.name}
            </div>
            <p className="text-[13px]" style={{ color: "#c7c7cc" }}>
              {cert.courseTitle}
            </p>
            <div className="text-[11px] tabular-nums mt-2" style={{ color: "#98989d" }}>
              No: {cert.serialNo}
              {issued ? ` · Issued ${dmy(issued)}` : ""}
            </div>
          </div>

          {/* Tarih teyidi — elindeki belgeyle aynı mı */}
          <form
            onSubmit={confirmDate}
            className="mt-4 pt-4"
            style={{ borderTop: "1px solid rgba(255,255,255,.12)" }}
          >
            <label className={pubLabel}>Confirm the date on the document</label>
            <div className="flex gap-2">
              <input
                className={pubInput}
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
                className="shrink-0 rounded-[10px] px-4 text-[13px] font-semibold text-white bg-white/10 border border-white/15 hover:bg-white/15 disabled:opacity-40 transition"
              >
                Verify
              </button>
            </div>

            {checked === true && (
              <p
                className="mt-3 rounded-[9px] text-[12.5px] font-semibold px-3 py-2"
                style={{
                  background: "rgba(48,177,90,.16)",
                  border: "1px solid rgba(48,177,90,.35)",
                  color: "#86e0a6",
                }}
              >
                Verified — the number and date match our records.
              </p>
            )}
            {checked === false && (
              <p
                className="mt-3 rounded-[9px] text-[12.5px] font-semibold px-3 py-2"
                style={{
                  background: "rgba(224,51,44,.16)",
                  border: "1px solid rgba(224,51,44,.35)",
                  color: "#ffb4b1",
                }}
              >
                Date does not match. This number was issued on {dmy(issued)}.
              </p>
            )}
            {checked === null && (
              <p className="text-[10.5px] mt-1.5" style={{ color: "#8e8e93" }}>
                Enter the certificate date printed on the document.
              </p>
            )}
          </form>
        </>
      )}

      {state === "idle" && (
        <p className="text-[12px] mt-4" style={{ color: "#98989d" }}>
          Enter the certificate number, or scan the QR code on the document.
        </p>
      )}
    </PublicShell>
  );
}