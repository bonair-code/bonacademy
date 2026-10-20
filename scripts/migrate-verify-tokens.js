/**
 * Doğrulama kayıtlarını seri numarasından tahmin edilemez anahtara taşır.
 *
 * `certVerify` dokümanları seri numarasıyla anahtarlanıyordu ve herkese açık
 * okunabiliyor. Numaralar sıralı olduğu için (26-001, 26-002…) doğrulama
 * adresinden sırayla girilip bütün personelin adı ve aldığı eğitim
 * dökülebiliyordu. Artık her sertifikanın rastgele bir `verifyToken` alanı
 * var; QR onu taşıyor, doğrulama sayfası onunla arıyor.
 *
 * Bu göç fiziksel hiçbir belgeyi bozmaz: sistemden üretilmiş QR'lı
 * sertifikaların hepsi daha önce silindi, kalanlar sistem öncesi kâğıt
 * kayıtlar ve üzerlerinde QR yok.
 *
 *   node scripts/migrate-verify-tokens.js            → dry run
 *   node scripts/migrate-verify-tokens.js --apply    → uygular
 */
const path = require("path");
const { createRequire } = require("module");
const { randomBytes } = require("crypto");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const token = () => randomBytes(16).toString("base64url");

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  const certs = await db.collection("certificates").get();
  const verify = await db.collection("certVerify").get();

  const needToken = certs.docs.filter((d) => !d.data().verifyToken);
  // Anahtarı seri numarası olan eski kayıtlar — silinecek.
  const bySerial = verify.docs.filter((d) => !/^[A-Za-z0-9_-]{22}$/.test(d.id));

  console.log(`sertifika: ${certs.size} · anahtarı olmayan: ${needToken.length}`);
  console.log(`certVerify: ${verify.size} · numaraya dayalı (silinecek): ${bySerial.length}`);

  if (!APPLY) {
    console.log("\n[dry run] Hiçbir şey değişmedi. Uygulamak için: --apply");
    return;
  }

  let made = 0;
  for (let i = 0; i < certs.docs.length; i += 200) {
    const batch = db.batch();
    for (const d of certs.docs.slice(i, i + 200)) {
      const x = d.data();
      const t = x.verifyToken || token();
      if (!x.verifyToken) batch.update(d.ref, { verifyToken: t });
      batch.set(db.doc(`certVerify/${t}`), {
        serialNo: x.serialNo ?? "",
        name: x.userName ?? "",
        courseTitle: x.courseTitle ?? "",
        issuedAt: x.issuedAt ?? null,
        certificateId: d.id,
      });
      made++;
    }
    await batch.commit();
  }
  console.log(`anahtarlı doğrulama kaydı yazıldı: ${made}`);

  // Eski kayıtlar ancak yenileri yazıldıktan SONRA silinir; arada bir an
  // doğrulama boşta kalmasın.
  let removed = 0;
  for (let i = 0; i < bySerial.length; i += 200) {
    const batch = db.batch();
    for (const d of bySerial.slice(i, i + 200)) {
      batch.delete(d.ref);
      removed++;
    }
    await batch.commit();
  }
  console.log(`numaraya dayalı kayıt silindi: ${removed}`);
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
