import { useEffect, useState } from "react";
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
  /** İmza hanesi. Sınıf eğitiminde eğitmen; online eğitimde boş. */
  instructorName?: string | null;
  userName: string;
  issuedAt?: Timestamp | null;
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  durationHours?: number | null;
  trainingStartedAt?: Timestamp | null;
  trainingCompletedAt?: Timestamp | null;
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

export function fmtTs(ts?: Timestamp | null) {
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
   * İmza hanesi yalnızca sınıf eğitiminde var. Online eğitimde imzalayacak
   * kimse yok; boş imza çizgisi bırakmak "imzalanmamış belge" izlenimi
   * veriyordu. Kalite müdürü hanesi kaldırıldı, yerini doğrulama QR'ı aldı.
   */
  const isSigned = !!cert.instructorName?.trim();

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
    QRCode.toDataURL(verifyUrl, { width: 240, margin: 0 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [verifyUrl]);

  const examText =
    cert.issuedVia === "IMPORT"
      ? null
      : cert.examRequired === false
      ? "Exam: Not required"
      : cert.examScore != null
      ? `Exam Score: ${cert.examScore}%${
          cert.examPassingScore != null ? ` (pass mark ${cert.examPassingScore}%)` : ""
        }`
      : null;

  return (
    <div
      className="cert-print bg-white"
      style={{ aspectRatio: "297 / 210", containerType: "inline-size" }}
    >
      <div className="h-full w-full" style={{ padding: "1.2cqw" }}>
        <div
          className="h-full w-full"
          style={{ border: "0.7cqw solid #1f3f6e", padding: "0.5cqw" }}
        >
          <div
            className="h-full w-full flex flex-col"
            style={{ border: "0.12cqw solid #1f3f6e", position: "relative" }}
          >
            {/* Filigran. CSS background-image değil gerçek <img>: index.css'teki
                baskı kuralı `visibility` ile çalışıyor ve ata elemanların
                arkaplan görselini çıktıya almıyor. Boyut cqw ile, yani ekranda
                ve A4'te aynı oranda.

                Dosya yoksa gizlenir — sertifika filigransız, eskisi gibi
                basılır; eksik bir görsel yüzünden belge bozulmaz. */}
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
                width: "62cqw",
                maxHeight: "70%",
                objectFit: "contain",
                opacity: 0.06,
                filter: "grayscale(1)",
                pointerEvents: "none",
                userSelect: "none",
              }}
            />

            {/* Gövde — dikeyde ortalı. Filigranın üstünde kalmalı. */}
            <div
              className="flex-1 flex flex-col items-center justify-center text-center"
              style={{ padding: "1.6cqw 6cqw 0.6cqw", position: "relative", zIndex: 1 }}
            >
              <img
                src="/Logo.png"
                alt="BonAir"
                style={{ height: "5.2cqw", width: "auto", marginBottom: "1.1cqw" }}
              />

              <div
                className="font-bold text-slate-800"
                style={{ fontSize: "1.7cqw", letterSpacing: "0.02em" }}
              >
                {cert.organisationName || ORG.name}
              </div>
              <div className="text-slate-600" style={{ fontSize: "1.35cqw", marginTop: "0.8cqw" }}>
                {cert.approvalNo
                  ? `Turkish DGCA SHT 145 Approval No: ${cert.approvalNo}`
                  : ORG.approvalLine}
              </div>

              <h2
                className="text-slate-900"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 400,
                  fontSize: "4.1cqw",
                  lineHeight: 1.05,
                  marginTop: "0.7cqw",
                  letterSpacing: "0.01em",
                }}
              >
                Training Certificate
              </h2>

              <div className="text-slate-600" style={{ fontSize: "1.4cqw", marginTop: "0.6cqw" }}>
                This is to certify that
              </div>
              <div
                lang="tr"
                className="text-slate-900"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  fontSize: "2.9cqw",
                  marginTop: "0.4cqw",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {cert.userName}
              </div>

              {birth && (
                <>
                  <div
                    className="font-semibold text-slate-600"
                    style={{ fontSize: "1.15cqw", marginTop: "0.8cqw", letterSpacing: "0.04em" }}
                  >
                    PLACE &amp; DATE of BIRTH
                  </div>
                  <div className="text-slate-700" style={{ fontSize: "1.35cqw" }}>
                    {birth}
                  </div>
                </>
              )}

              <div className="text-slate-600" style={{ fontSize: "1.4cqw", marginTop: "0.6cqw" }}>
                Has successfully completed.
              </div>

              <div
                className="text-slate-900"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 600,
                  fontSize: "2.3cqw",
                  lineHeight: 1.2,
                  marginTop: "1cqw",
                  maxWidth: "88%",
                }}
              >
                {cert.courseTitle}
              </div>

              {cert.courseRevisionNo && (
                <div className="text-slate-500" style={{ fontSize: "1.15cqw", marginTop: "0.6cqw" }}>
                  Training Revision {cert.courseRevisionNo}
                  {cert.courseRevisionDate
                    ? ` · ${cert.courseRevisionDate.split("-").reverse().join(".")}`
                    : ""}
                </div>
              )}

              {cert.durationHours != null && (
                <div
                  className="text-slate-700"
                  style={{ fontSize: "1.35cqw", marginTop: "0.9cqw" }}
                >
                  Duration: {cert.durationHours} Hours
                </div>
              )}
              {heldText && (
                <div className="text-slate-700" style={{ fontSize: "1.35cqw" }}>
                  {heldText}
                </div>
              )}
              <div className="text-slate-700" style={{ fontSize: "1.35cqw" }}>
                By {ORG.issuedBy}
              </div>
              {examText && (
                <div
                  className="font-semibold text-slate-800"
                  style={{ fontSize: "1.35cqw", marginTop: "0.5cqw" }}
                >
                  {examText}
                </div>
              )}
            </div>

            {/* Alt şerit — tek satırda üç sütun:
                solda imza hanesi, ortada belge künyesi, sağda doğrulama QR'ı.
                Eskiden imza satırı ve künye ayrı bloklardı; ikisi birlikte
                sayfayı taşırıyor ve numara kesiliyordu. */}
            <div
              className="flex items-end justify-between"
              style={{ padding: "0 5cqw 1cqw", gap: "2cqw", position: "relative", zIndex: 1 }}
            >
              {/* Sınıf eğitiminde eğitmen imzalar → boş satır + çizgi.
                  Online eğitimde imzalayacak kimse yok; çizgi bırakmak
                  "imzalanmamış belge" izlenimi veriyordu, o yüzden yalnızca
                  belgeyi kimin ürettiğini yazıyoruz. */}
              <div className="text-center" style={{ width: "27%" }}>
                {isSigned ? (
                  <>
                    <div style={{ height: "4.2cqw" }} />
                    <div className="border-t border-slate-400" />
                    <div
                      className="font-semibold text-slate-800"
                      style={{ fontSize: "1.3cqw", marginTop: "0.4cqw", lineHeight: 1.25 }}
                    >
                      {cert.instructorName}
                    </div>
                    <div className="text-slate-600" style={{ fontSize: "1.1cqw", lineHeight: 1.25 }}>
                      Instructor
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ height: "3.4cqw" }} />
                    <div
                      className="font-semibold text-slate-700"
                      style={{ fontSize: "1.2cqw", lineHeight: 1.3 }}
                    >
                      Created by BonAcademy
                    </div>
                  </>
                )}
              </div>

              <div className="text-center" style={{ flex: 1 }}>
                <div
                  className="font-semibold text-slate-800"
                  style={{ fontSize: "1.4cqw", lineHeight: 1.5 }}
                >
                  Certificate No: {cert.serialNo}
                </div>
                <div
                  className="font-semibold text-slate-800"
                  style={{ fontSize: "1.4cqw", lineHeight: 1.5 }}
                >
                  Certificate Date: {fmtTs(cert.issuedAt)}
                </div>
              </div>

              <div className="flex flex-col items-center" style={{ width: "27%" }}>
                {qr && (
                  <img
                    src={qr}
                    alt="Verification QR code"
                    style={{ width: "7cqw", height: "7cqw" }}
                  />
                )}
                <div
                  className="text-slate-500 text-center"
                  style={{ fontSize: "0.95cqw", marginTop: "0.3cqw", lineHeight: 1.25 }}
                >
                  Scan to verify
                </div>
              </div>
            </div>

            {/* Form künyesi */}
            <div
              className="border-t border-slate-300 flex items-center justify-between text-slate-600"
              style={{ padding: "0.5cqw 3cqw", fontSize: "1cqw", position: "relative", zIndex: 1 }}
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
