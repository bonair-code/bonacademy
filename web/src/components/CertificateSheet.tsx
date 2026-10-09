import { useEffect, useState, type CSSProperties } from "react";
import type { Timestamp } from "firebase/firestore";
import QRCode from "qrcode";
import { ORG } from "../lib/org";

export type Cert = {
  id: string;
  serialNo: string;
  courseTitle: string;
  /** Eğitimin alındığı kurs revizyonu — belgeyi denetlenebilir kılar. */
  courseRevisionNo?: string | null;
  courseRevisionDate?: string | null;
  /** Sınıf eğitiminin eğitmeni. Sertifikaya BASILMAZ (CAPELLA: imza yok, yalnızca QR); kayıt ekranlarında görünür. */
  instructorName?: string | null;
  userName: string;
  issuedAt?: Timestamp | null;
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  durationHours?: number | null;
  /** Online: Timestamp. Sınıf oturumu: "YYYY-MM-DD" metni. */
  trainingStartedAt?: Timestamp | string | null;
  trainingCompletedAt?: Timestamp | string | null;
  heldIn?: string | null;
  organisationName?: string | null;
  approvalNo?: string | null;
  examRequired?: boolean | null;
  examScore?: number | null;
  examPassingScore?: number | null;
  /** IMPORT: kâğıt sicilden aktarılan kayıt — sınav satırı basılmaz. */
  issuedVia?: string | null;
  /** QR doğrulama anahtarı. Numara DEĞİL — numaralar sıralı ve tahmin edilir. */
  verifyToken?: string | null;
};

export function fmtTs(ts?: Timestamp | string | null) {
  // Sınıf oturumu tarihleri metin ("YYYY-MM-DD") — eskiden "—" dönüyor,
  // sınıf sertifikasında eğitim tarihi hiç basılmıyordu.
  if (typeof ts === "string") return /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts.split("-").reverse().join(".") : "—";
  return ts?.toDate?.().toLocaleDateString("tr-TR") ?? "—";
}

/** YYYY-MM-DD → DD.MM.YYYY */
function fmtISO(d?: string | null) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
}

/**
 * Yatay (landscape) sertifika. Ölçüler kabın genişliğine göre (cqw) verilir;
 * böylece hem ekranda hem A4 yazdırmada aynı oranda görünür.
 * Belge metinleri yalnızca İngilizce.
 */
/** Tören satırları (başlık, isim, kurs adı) serif; künye ve ince yazı Inter. */
const SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';

/**
 * Sertifika zeminindeki soluk uçak görseli. web/public/ altında duruyor
 * (Logo.png ile aynı kalıp). Dosya yoksa img gizlenir.
 */
const WATERMARK_SRC = "/cert-watermark.jpg";

export function CertificateSheet({ cert }: { cert: Cert }) {
  const birth = [cert.birthPlace, fmtISO(cert.birthDate)].filter(Boolean).join(" & ");
  const start = fmtTs(cert.trainingStartedAt);
  const end = fmtTs(cert.trainingCompletedAt);
  const heldRange =
    start !== "—" && end !== "—" && start !== end ? `${start} - ${end}` : end !== "—" ? end : null;

  // Yer bilgisi yoksa "online" DİYE VARSAYMA — yüz yüze verilmiş bir eğitimin
  // sertifikasında "held online" yazması belgeyi yanlış kılıyordu.
  const location = (cert.heldIn ?? "").trim();
  const placeText = !location
    ? null
    : location.toUpperCase() === "ONLINE"
    ? "online"
    : `in ${location}`;
  const heldText = heldRange
    ? placeText
      ? `On ${heldRange} held ${placeText}`
      : `On ${heldRange}`
    : placeText
    ? `Delivered ${placeText}`
    : null;

  /**
   * QR herkese açık doğrulama sayfasına gider ve tahmin edilemez bir anahtar
   * taşır. Adres numaraya dayansaydı (26-001, 26-002…) sayfadan sırayla
   * girilip bütün personelin adı ve eğitimi dökülebilirdi.
   */
  const verifyUrl = cert.verifyToken
    ? `${window.location.origin}/verify/${encodeURIComponent(cert.verifyToken)}`
    : "";
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!verifyUrl) {
      setQr("");
      return;
    }
    QRCode.toDataURL(verifyUrl, { width: 240, margin: 0, color: { dark: "#18284b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [verifyUrl]);

  // Sınav notu sertifikaya BASILMAZ (CAPELLA kararı). Not kayıtta duruyor:
  // examScore alanı ve doğrulama/kayıt ekranları onu göstermeye devam eder.

  /** Altın ince çizgi ve köşe süsleri — lacivert çerçevenin içinde. */
  const GOLD = "#b08d45";
  const NAVY = "#2b4685";
  const NAVY_D = "#18284b";
  const corner = (pos: CSSProperties): CSSProperties => ({
    position: "absolute",
    width: "3.2cqw",
    height: "3.2cqw",
    borderColor: GOLD,
    borderStyle: "solid",
    borderWidth: 0,
    pointerEvents: "none",
    ...pos,
  });
  const cw = "0.25cqw";

  return (
    <div
      className="cert-print bg-white"
      style={{ aspectRatio: "297 / 210", containerType: "inline-size" }}
    >
      <div className="h-full w-full" style={{ padding: "1.4cqw" }}>
        <div
          className="h-full w-full"
          style={{ border: `0.55cqw solid ${NAVY}`, padding: "0.45cqw" }}
        >
          <div
            className="h-full w-full flex flex-col"
            style={{ border: `0.1cqw solid ${GOLD}`, position: "relative" }}
          >
            <span style={corner({ top: "0.8cqw", left: "0.8cqw", borderTopWidth: cw, borderLeftWidth: cw })} />
            <span style={corner({ top: "0.8cqw", right: "0.8cqw", borderTopWidth: cw, borderRightWidth: cw })} />
            <span style={corner({ bottom: "0.8cqw", left: "0.8cqw", borderBottomWidth: cw, borderLeftWidth: cw })} />
            <span style={corner({ bottom: "0.8cqw", right: "0.8cqw", borderBottomWidth: cw, borderRightWidth: cw })} />

            {/* Filigran. CSS background-image değil gerçek <img>: index.css'teki
                baskı kuralı `visibility` ile çalışıyor ve ata elemanların
                arkaplan görselini çıktıya almıyor. Dosya yoksa gizlenir. */}
            <img
              src={WATERMARK_SRC}
              alt=""
              aria-hidden="true"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              style={{
                position: "absolute",
                left: "50%",
                top: "52%",
                transform: "translate(-50%, -50%)",
                width: "66cqw",
                maxHeight: "66%",
                objectFit: "contain",
                // Çizim beyaz zeminli: multiply ile zemin kayboluyor. Baskıda
                // blend mode'a güvenilmediği için opaklık tek başına da yeterli.
                mixBlendMode: "multiply",
                opacity: 0.1,
                pointerEvents: "none",
                userSelect: "none",
              }}
            />

            {/* Gövde — dikeyde ortalı. Filigranın üstünde kalmalı. */}
            <div
              className="flex-1 flex flex-col items-center justify-center text-center"
              style={{ padding: "1.4cqw 6cqw 0", position: "relative", zIndex: 1 }}
            >
              <img
                src="/Logo.png"
                alt={cert.organisationName || ORG.name}
                style={{ height: "5.4cqw", width: "auto" }}
              />
              <div
                className="text-slate-500"
                style={{ fontSize: "1.05cqw", letterSpacing: "0.12em", marginTop: "0.4cqw" }}
              >
                {ORG.website}
              </div>

              <h2
                style={{
                  fontFamily: SERIF,
                  fontWeight: 400,
                  fontSize: "4.2cqw",
                  lineHeight: 1.05,
                  marginTop: "0.9cqw",
                  color: NAVY_D,
                }}
              >
                Training Certificate
              </h2>
              <div
                className="flex items-center"
                style={{ gap: "1cqw", width: "24cqw", margin: "0.6cqw 0 0.5cqw", color: GOLD, fontSize: "1.2cqw" }}
                aria-hidden="true"
              >
                <span style={{ flex: 1, height: "0.1cqw", background: GOLD }} />★
                <span style={{ flex: 1, height: "0.1cqw", background: GOLD }} />
              </div>

              <div className="text-slate-600" style={{ fontSize: "1.4cqw" }}>
                This is to certify that
              </div>
              <div
                lang="tr"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  fontSize: "3cqw",
                  marginTop: "0.3cqw",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: NAVY_D,
                }}
              >
                {cert.userName}
              </div>

              {birth && (
                <>
                  <div
                    className="font-semibold text-slate-500"
                    style={{ fontSize: "1cqw", marginTop: "0.5cqw", letterSpacing: "0.08em" }}
                  >
                    PLACE &amp; DATE OF BIRTH
                  </div>
                  <div lang="tr" className="text-slate-700" style={{ fontSize: "1.3cqw" }}>
                    {birth}
                  </div>
                </>
              )}

              <div className="text-slate-600" style={{ fontSize: "1.4cqw", marginTop: "0.8cqw" }}>
                has successfully completed
              </div>
              <div
                className="text-slate-900"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 600,
                  fontSize: "2.4cqw",
                  lineHeight: 1.2,
                  marginTop: "0.6cqw",
                  maxWidth: "88%",
                }}
              >
                {cert.courseTitle}
              </div>

              {cert.courseRevisionNo && (
                <div className="text-slate-500" style={{ fontSize: "1.1cqw", marginTop: "0.3cqw" }}>
                  Training Revision {cert.courseRevisionNo}
                  {cert.courseRevisionDate
                    ? ` · ${cert.courseRevisionDate.split("-").reverse().join(".")}`
                    : ""}
                </div>
              )}

              {(cert.durationHours != null || heldText) && (
                <div className="text-slate-700" style={{ fontSize: "1.3cqw", marginTop: "0.8cqw" }}>
                  {[cert.durationHours != null ? `Duration: ${cert.durationHours} Hours` : null, heldText]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              <div className="text-slate-700" style={{ fontSize: "1.3cqw" }}>
                By {ORG.issuedBy}
              </div>
            </div>

            {/* Alt şerit: ortada belge künyesi, sağda doğrulama QR'ı. İmza
                hanesi YOK — belgeyi kimin verdiğini QR doğruluyor. Soldaki boş
                sütun künyeyi tam ortada tutmak için. */}
            <div
              className="flex items-end justify-between"
              style={{ padding: "0 5cqw 1cqw", gap: "2cqw", position: "relative", zIndex: 1 }}
            >
              <div style={{ width: "26%" }} />

              <div className="text-center text-slate-800" style={{ flex: 1, fontSize: "1.35cqw", lineHeight: 1.55 }}>
                <div>
                  Certificate No: <b>{cert.serialNo}</b>
                </div>
                <div>
                  Certificate Date: <b>{fmtTs(cert.issuedAt)}</b>
                </div>
              </div>

              <div className="flex flex-col items-center" style={{ width: "26%" }}>
                {qr && (
                  <img
                    src={qr}
                    alt="Verification QR code"
                    style={{ width: "6.6cqw", height: "6.6cqw" }}
                  />
                )}
                <div
                  className="text-slate-500 text-center"
                  style={{ fontSize: "0.9cqw", marginTop: "0.3cqw", lineHeight: 1.25 }}
                >
                  Scan to verify
                </div>
              </div>
            </div>

            {/* Form künyesi */}
            <div
              className="border-t border-slate-300 flex items-center justify-between text-slate-500"
              style={{ padding: "0.5cqw 5.5cqw", fontSize: "0.95cqw", position: "relative", zIndex: 1 }}
            >
              <span>Form No: {ORG.footer.formNo}</span>
              <span>Revision No: {ORG.footer.revisionNo}</span>
              <span>Revision Date: {ORG.footer.revisionDate}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
