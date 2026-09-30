import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { PublicShell } from "../components/PublicShell";
import { db } from "../lib/firebase";

type CertV = {
  serialNo: string;
  name: string;
  courseTitle: string;
  issuedAt?: Timestamp | null;
};

const dmy = (d?: Date | null) => (d ? d.toLocaleDateString("tr-TR") : "");

/**
 * Herkese açık sertifika doğrulama — YALNIZCA belgedeki QR ile.
 *
 * İki şey bilerek yok:
 *
 * 1. **Numara arama kutusu yok.** Numaralar sıralı (26-001, 26-002…); serbest
 *    arama bırakılırsa biri sırayla girip bütün personelin adını ve aldığı
 *    eğitimi dökebilir. Adres satırından denemesin diye anahtar da numara
 *    değil, tahmin edilemez bir dizi (`verifyToken`).
 *
 * 2. **"Belgedeki tarihi gir" adımı yok.** QR zaten kaydı getiriyor; fazladan
 *    adım hiçbir şey eklemiyordu, üstelik sayfa açılır açılmaz kırmızı
 *    "tarih eşleşmiyor" uyarısı veriyordu. Tarih kartta yazıyor, elindeki
 *    belgeyle karşılaştırmak için o yeterli.
 */
export function Verify() {
  const { serialNo: token } = useParams<{ serialNo: string }>();
  const [cert, setCert] = useState<CertV | null>(null);
  const [state, setState] = useState<"loading" | "found" | "none" | "noToken">(
    token ? "loading" : "noToken"
  );

  useEffect(() => {
    if (!token) return;
    let alive = true;
    getDoc(doc(db, "certVerify", token.trim()))
      .then((s) => {
        if (!alive) return;
        if (s.exists()) {
          setCert(s.data() as CertV);
          setState("found");
        } else {
          setCert(null);
          setState("none");
        }
      })
      .catch(() => {
        if (!alive) return;
        setCert(null);
        setState("none");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const issued = cert?.issuedAt?.toDate?.() ?? null;

  return (
    <PublicShell
      title="Certificate verification"
      subtitle={
        state === "noToken"
          ? undefined
          : state === "loading"
          ? "Checking the register…"
          : undefined
      }
      width="max-w-[440px]"
    >
      {state === "noToken" && (
        <p className="text-[12.5px] leading-relaxed" style={{ color: "#c7c7cc" }}>
          Scan the QR code printed on the certificate to verify it. Certificates can only be
          checked through their own QR code.
        </p>
      )}

      {state === "loading" && (
        <p className="text-[13px]" style={{ color: "#98989d" }}>
          Checking…
        </p>
      )}

      {state === "none" && (
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(224,51,44,.16)", border: "1px solid rgba(224,51,44,.35)" }}
        >
          <div className="font-semibold text-[14px]" style={{ color: "#ffb4b1" }}>
            Not a valid certificate
          </div>
          <p className="text-[12px] mt-1" style={{ color: "rgba(255,180,177,.8)" }}>
            This code is not registered. Make sure you scanned the QR code on the document itself.
          </p>
        </div>
      )}

      {state === "found" && cert && (
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(48,177,90,.14)", border: "1px solid rgba(48,177,90,.32)" }}
        >
          <div className="font-semibold text-[13px]" style={{ color: "#86e0a6" }}>
            ✓ Registered certificate
          </div>
          <div className="text-[19px] font-semibold text-white mt-2.5 tracking-[-0.018em]">
            {cert.name}
          </div>
          <p className="text-[13px] mt-0.5" style={{ color: "#c7c7cc" }}>
            {cert.courseTitle}
          </p>

          {/* Numara ve tarih ayrı satırlarda: denetçi elindeki belgeyle
              gözüyle karşılaştırıyor, ayrıca bir adım gerekmiyor. */}
          <div
            className="mt-3 pt-3 grid grid-cols-2 gap-3"
            style={{ borderTop: "1px solid rgba(48,177,90,.25)" }}
          >
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.09em]"
                style={{ color: "#8e8e93" }}
              >
                Certificate No
              </div>
              <div className="text-[13.5px] font-semibold text-white tabular-nums mt-0.5">
                {cert.serialNo}
              </div>
            </div>
            <div>
              <div
                className="text-[9.5px] font-semibold uppercase tracking-[0.09em]"
                style={{ color: "#8e8e93" }}
              >
                Certificate Date
              </div>
              <div className="text-[13.5px] font-semibold text-white tabular-nums mt-0.5">
                {issued ? dmy(issued) : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </PublicShell>
  );
}
