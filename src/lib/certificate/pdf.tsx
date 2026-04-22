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
  renderToBuffer,
} from "@react-pdf/renderer";

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
  page: { padding: 40, fontSize: 12, fontFamily: "Helvetica", backgroundColor: "#ffffff" },
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
  logoText: { fontSize: 32, fontFamily: "Helvetica-Bold", color: "#1a1a1a", letterSpacing: 2 },
  title: {
    fontSize: 30,
    textAlign: "center",
    marginTop: 20,
    marginBottom: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    letterSpacing: 4,
  },
  subtitle: { fontSize: 11, textAlign: "center", color: "#64748b", marginBottom: 28, letterSpacing: 2 },
  body: { fontSize: 13, textAlign: "center", marginTop: 6, color: "#334155" },
  name: {
    fontSize: 26,
    textAlign: "center",
    marginVertical: 18,
    fontFamily: "Helvetica-Bold",
    color: "#b91c1c",
  },
  course: { fontFamily: "Helvetica-Bold", color: "#0f172a" },
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

export async function renderCertificatePdf(opts: {
  name: string;
  courseTitle: string;
  issuedAt: Date;
  serialNo: string;
}): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          <View style={styles.accent} />
          <Logo />
          <Text style={styles.title}>BAŞARI SERTİFİKASI</Text>
          <Text style={styles.subtitle}>CERTIFICATE OF ACHIEVEMENT</Text>
          <Text style={styles.body}>Bu sertifika</Text>
          <Text style={styles.name}>{opts.name}</Text>
          <Text style={styles.body}>
            adlı kişinin <Text style={styles.course}>{opts.courseTitle}</Text> eğitimini
            başarıyla tamamladığını belgelemek üzere düzenlenmiştir.
          </Text>
          <Text style={styles.brandFooter}>Bon Air Havacılık Sanayi ve Ticaret A.Ş. · BonAcademy</Text>

          <View style={styles.footerRow}>
            <Text>Tarih: {opts.issuedAt.toLocaleDateString("tr-TR")}</Text>
            <Text>Seri No: {opts.serialNo}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
