import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import QRCode from "qrcode";

// Türkçe karakterler (ş, ğ, ı, İ, Ş, Ğ, ü, ö, ç) Helvetica built-in fontunda
// yoktu ve PDF'te bozuk/üst üste görünüyordu. public/fonts içine Roboto'nun
// latin-ext destekli TTF dosyalarını koyduk ve burada "Roboto" ailesi olarak
// register ediyoruz. Register idempotent çalışsın diye modül yüklemesinde
// tek sefer yapıyoruz.
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  try {
    const regular = path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf");
    const bold = path.join(process.cwd(), "public", "fonts", "Roboto-Bold.ttf");
    Font.register({
      family: "Roboto",
      fonts: [
        { src: regular },
        { src: bold, fontWeight: "bold" },
      ],
    });
    // fontkit'in kelime kesme algoritmasını kapat — Türkçe'de yanlış yerlerden
    // bölebiliyor; zaten sertifika metinleri kısa.
    Font.registerHyphenationCallback((word) => [word]);
    fontsRegistered = true;
  } catch (err) {
    console.error("[pdf] font register failed", err);
  }
}

// Logoyu bir kere okuyup bellekte tut; her sertifikada diskten okumaya gerek yok.
let cachedLogo: Buffer | null = null;
function loadLogo(): Buffer | null {
  if (cachedLogo) return cachedLogo;
  try {
    const p = path.join(process.cwd(), "public", "Logo.png");
    cachedLogo = fs.readFileSync(p);
    return cachedLogo;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 12, fontFamily: "Roboto", backgroundColor: "#ffffff" },
  border: {
    border: "2pt solid #0f172a",
    borderRadius: 6,
    padding: 40,
    height: "100%",
    position: "relative",
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: "#e30613",
  },
  logoRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 6, marginBottom: 18 },
  logoText: { fontSize: 32, fontFamily: "Roboto", fontWeight: "bold", color: "#1a1a1a", letterSpacing: 2 },
  title: {
    fontSize: 30,
    textAlign: "center",
    marginTop: 20,
    marginBottom: 10,
    fontFamily: "Roboto", fontWeight: "bold",
    color: "#0f172a",
    letterSpacing: 4,
  },
  subtitle: { fontSize: 11, textAlign: "center", color: "#64748b", marginBottom: 28, letterSpacing: 2 },
  body: { fontSize: 13, textAlign: "center", marginTop: 6, color: "#334155" },
  name: {
    fontSize: 26,
    textAlign: "center",
    marginVertical: 18,
    fontFamily: "Roboto", fontWeight: "bold",
    color: "#b91c1c",
  },
  course: { fontFamily: "Roboto", fontWeight: "bold", color: "#0f172a" },
  footerRow: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 10,
    color: "#475569",
  },
  brandFooter: { textAlign: "center", fontSize: 10, color: "#64748b", marginTop: 40 },
  // Sertifikanın sağ alt köşesi: "Sorumlu" bloğu. footerRow'un (Tarih / Seri No)
  // hemen üstüne, sağa hizalı olarak basılır.
  ownerRow: {
    position: "absolute",
    bottom: 70,
    right: 40,
    alignItems: "flex-end",
  },
  ownerLabel: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  // Sol alt: QR kod bloğu. footerRow'un (Tarih) üzerine hizalı.
  qrRow: {
    position: "absolute",
    bottom: 70,
    left: 40,
    alignItems: "flex-start",
    maxWidth: 200,
  },
  qrImage: { width: 70, height: 70 },
  qrLabel: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 4,
  },
  qrHint: { fontSize: 7, color: "#94a3b8", marginTop: 1 },
  ownerName: {
    fontSize: 12,
    fontFamily: "Roboto",
    fontWeight: "bold",
    color: "#0f172a",
    marginTop: 2,
    borderTop: "1pt solid #0f172a",
    paddingTop: 4,
    minWidth: 150,
    textAlign: "center",
  },
});

function Logo() {
  const data = loadLogo();
  return (
    <View style={styles.logoRow}>
      {data ? (
        // @react-pdf/renderer Image src Buffer'ı destekler.
        <Image src={data} style={{ height: 60, width: "auto" }} />
      ) : (
        <Text style={styles.logoText}>BON AIR</Text>
      )}
    </View>
  );
}

export type CertificateKind = "achievement" | "participation";

export async function renderCertificatePdf(opts: {
  name: string;
  courseTitle: string;
  issuedAt: Date;
  serialNo: string;
  kind?: CertificateKind;
  ownerManagerName?: string | null;
  verifyUrl?: string;
}): Promise<Buffer> {
  registerFonts();
  // QR kodu: doğrulama sayfasına işaret eder. PNG data URL üretiyoruz;
  // @react-pdf/renderer <Image src="data:image/png;base64,..."> destekler.
  // Hata toleransı H → QR'ın ~%30'u hasar görse bile okunabilir (logo
  // bindirmeleri, yazıcı artefaktları için güvenli seçim).
  let qrDataUrl: string | null = null;
  if (opts.verifyUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(opts.verifyUrl, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 256,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
    } catch (err) {
      console.error("[pdf] qr generation failed", err);
    }
  }
  const kind = opts.kind ?? "achievement";
  const title =
    kind === "participation" ? "KATILIM SERTİFİKASI" : "BAŞARI SERTİFİKASI";
  const subtitle =
    kind === "participation"
      ? "CERTIFICATE OF PARTICIPATION"
      : "CERTIFICATE OF ACHIEVEMENT";
  const bodySuffix =
    kind === "participation"
      ? "eğitimine katıldığını belgelemek üzere düzenlenmiştir."
      : "eğitimini başarıyla tamamladığını belgelemek üzere düzenlenmiştir.";
  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          <View style={styles.accent} />
          <Logo />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <Text style={styles.body}>Bu sertifika</Text>
          <Text style={styles.name}>{opts.name}</Text>
          <Text style={styles.body}>
            adlı kişinin <Text style={styles.course}>{opts.courseTitle}</Text>{" "}
            {bodySuffix}
          </Text>
          <Text style={styles.brandFooter}>Bon Air Havacılık Sanayi ve Ticaret A.Ş. · BonAcademy</Text>

          <View style={styles.footerRow}>
            <Text>Tarih: {opts.issuedAt.toLocaleDateString("tr-TR")}</Text>
            <Text>Seri No: {opts.serialNo}</Text>
          </View>
          {qrDataUrl ? (
            <View style={styles.qrRow}>
              <Image src={qrDataUrl} style={styles.qrImage} />
              <Text style={styles.qrLabel}>Doğrulama</Text>
              <Text style={styles.qrHint}>
                QR'ı okutun veya adresi ziyaret edin
              </Text>
            </View>
          ) : null}
          {opts.ownerManagerName ? (
            <View style={styles.ownerRow}>
              <Text style={styles.ownerLabel}>Sorumlu</Text>
              <Text style={styles.ownerName}>{opts.ownerManagerName}</Text>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
