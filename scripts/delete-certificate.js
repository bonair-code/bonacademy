/**
 * Tek bir sertifikayı seri numarasıyla siler — deneme belgeleri için.
 *
 * Belgeyle birlikte DOĞRULAMA KAYDI da silinir (`certVerify/<verifyToken>`);
 * kalırsa QR adresi silinmiş bir sertifikayı "kayıtlı" göstermeye devam eder.
 *
 * SAYAÇ: silinen numara serinin SONUNCUSU ise `counters/certificates.next`
 * bir geri alınır, böylece sicilde boşluk kalmaz ve sıradaki gerçek belge o
 * numarayı alır. Ortadan bir numara siliniyorsa sayaca DOKUNULMAZ — geri
 * almak, verilmiş bir numaranın ikinci kez üretilmesine yol açardı.
 *
 *   node scripts/delete-certificate.js 26-138            → kuru çalıştırma
 *   node scripts/delete-certificate.js 26-138 --apply    → siler
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SERIAL = args.find((a) => !a.startsWith("--"));

if (!SERIAL) {
  console.error("Seri numarası gerekli. Örnek: node scripts/delete-certificate.js 26-138");
  process.exit(1);
}

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const fmt = (t) => t?.toDate?.()?.toLocaleString("tr-TR") ?? "—";
/** "26-138" → sıralanabilir sayı; yıl ve numara ayrı ayrı. */
const keyOf = (s) => {
  const m = /^(\d{2})-(\d+)$/.exec(String(s || ""));
  return m ? Number(m[1]) * 1e6 + Number(m[2]) : -1;
};

async function main() {
  const snap = await db.collection("certificates").where("serialNo", "==", SERIAL).get();
  if (snap.empty) {
    console.log(`${SERIAL} bulunamadı — silinecek bir şey yok.`);
    return;
  }

  console.log(`${SERIAL}: ${snap.size} belge`);
  for (const d of snap.docs) {
    const c = d.data();
    console.log(`  kişi      : ${c.userName ?? "—"}`);
    console.log(`  eğitim    : ${c.courseTitle ?? "—"}`);
    console.log(`  veriliş   : ${fmt(c.issuedAt)}  (${c.issuedVia ?? "online"})`);
    console.log(`  belge id  : ${d.id}`);
    console.log(`  doğrulama : ${c.verifyToken ? `certVerify/${c.verifyToken}` : "yok"}`);
    if (c.issuedVia === "IMPORT") {
      console.log("  ⚠ Bu kayıt KÂĞIT SİCİLDEN içe aktarılmış — gerçek bir belge olabilir.");
    }
  }

  // Sayaç yalnız serinin sonu siliniyorsa geri alınır.
  const all = await db.collection("certificates").get();
  const maxKey = Math.max(...all.docs.map((d) => keyOf(d.data().serialNo)));
  const sonuncu = keyOf(SERIAL) === maxKey;
  const ctrRef = db.doc("counters/certificates");
  const ctr = (await ctrRef.get()).data() || {};
  const m = /^(\d{2})-(\d+)$/.exec(SERIAL);
  const geriAlinacak =
    sonuncu && m && String(ctr.prefix ?? ctr.year) === m[1] && Number(ctr.next) === Number(m[2]) + 1;

  console.log(`\nsayaç     : ${JSON.stringify(ctr)}`);
  console.log(`serinin sonuncusu mu: ${sonuncu ? "evet" : "hayır"}`);
  console.log(
    geriAlinacak
      ? `sayaç ${ctr.next} → ${Number(m[2])} yapılacak (sicilde boşluk kalmasın)`
      : "sayaca dokunulmayacak"
  );

  if (!APPLY) {
    console.log("\nKURU ÇALIŞTIRMA — hiçbir şey silinmedi. Silmek için: --apply");
    return;
  }

  const batch = db.batch();
  for (const d of snap.docs) {
    const c = d.data();
    if (c.verifyToken) batch.delete(db.doc(`certVerify/${c.verifyToken}`));
    batch.delete(d.ref);
  }
  if (geriAlinacak) batch.update(ctrRef, { next: Number(m[2]) });
  await batch.commit();

  // Doğrulama: ne sertifika ne de doğrulama kaydı kalmalı.
  const sonra = await db.collection("certificates").where("serialNo", "==", SERIAL).get();
  let kalanToken = 0;
  for (const d of snap.docs) {
    const t = d.data().verifyToken;
    if (t && (await db.doc(`certVerify/${t}`).get()).exists) kalanToken++;
  }
  const ctr2 = (await ctrRef.get()).data();
  console.log(`\nbitti. kalan ${SERIAL}: ${sonra.size} (0 olmalı) · kalan doğrulama kaydı: ${kalanToken} (0 olmalı)`);
  console.log(`sayaç  : ${JSON.stringify(ctr2)}`);
  if (sonra.size > 0 || kalanToken > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
