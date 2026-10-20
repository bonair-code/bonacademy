/**
 * Deneme amaçlı üretilmiş sertifikaları siler.
 *
 * İkisi sınıf oturumu denemesinden (26-52, 26-131), ikisi online tamamlama
 * denemesinden (BA-00001, BA-00002). Sınıftan üretilen ikisi, kâğıt sicilden
 * içe aktarılan gerçek 26-052 ve 26-131 ile ÇAKIŞIYORDU — numaralandırma
 * birleştirilmeden önce oturumda elle numara girildiği için.
 *
 * İçe aktarılan (issuedVia: "IMPORT") kayıtlara DOKUNULMAZ; onlar gerçek
 * belgeler ve aslı kurumda.
 *
 *   node scripts/delete-test-certificates.js            → dry run
 *   node scripts/delete-test-certificates.js --apply    → siler
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const SERIALS = ["BA-00001", "BA-00002", "26-52", "26-131"];

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  const snap = await db.collection("certificates").get();
  const targets = snap.docs.filter((d) => {
    const x = d.data();
    // İçe aktarılan kayıt asla silinmez — aynı numarayı taşıyan gerçek belge o.
    return SERIALS.includes(String(x.serialNo)) && x.issuedVia !== "IMPORT";
  });

  if (targets.length === 0) {
    console.log("Silinecek kayıt yok.");
    return;
  }

  for (const d of targets) {
    const x = d.data();
    console.log(
      (APPLY ? "siliniyor" : "[dry]") +
        `  ${x.serialNo}  ${x.userName}  ${x.courseTitle}` +
        (x.sessionId ? "  (sınıf oturumu)" : "  (online)")
    );
  }

  if (!APPLY) {
    console.log("\n[dry run] Hiçbir şey silinmedi. Silmek için: --apply");
    return;
  }

  const batch = db.batch();
  for (const d of targets) {
    batch.delete(d.ref);
    const serial = String(d.data().serialNo);
    // Herkese açık doğrulama kaydı da gitmeli; aksi hâlde QR olmayan bir
    // belgeyi "geçerli" diye doğrular.
    if (serial) batch.delete(db.doc(`certVerify/${serial}`));
  }
  await batch.commit();
  console.log(`\nsilindi: ${targets.length} sertifika + doğrulama kaydı`);
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
