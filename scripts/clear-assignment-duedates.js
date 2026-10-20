/**
 * Bütün atamalardan `dueDate` alanını siler (kullanıcı kararı, CAPELLA'da
 * alınıp buraya taşındı: son tarih artık yalnızca istenirse konuyor,
 * otomatik 30 gün verilmiyor).
 *
 * Alan silinir, atama silinmez. Son tarihi olmayan atama ekranda
 * "son tarih yok" diye görünür; gecikme uyarısı üretmez.
 *
 * Kullanım:
 *   node scripts/clear-assignment-duedates.js            → kuru çalıştırma
 *   node scripts/clear-assignment-duedates.js --apply    → siler
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

const d2 = (n) => String(n).padStart(2, "0");
const fmt = (ts) => {
  const d = ts?.toDate?.();
  return d ? `${d2(d.getDate())}.${d2(d.getMonth() + 1)}.${d.getFullYear()}` : "?";
};

async function main() {
  const snap = await db.collection("assignments").get();
  const todo = snap.docs.filter((d) => d.data().dueDate != null);

  console.log(`atama toplam            : ${snap.size}`);
  console.log(`son tarihi olan         : ${todo.length}  ← silinecek`);
  for (const d of todo) {
    const a = d.data();
    console.log(`  ${fmt(a.dueDate)}  ${a.status ?? "-"}  ${a.courseTitle ?? d.id}`);
  }

  if (!APPLY) {
    console.log("\nKURU ÇALIŞTIRMA — hiçbir şey silinmedi. Silmek için: --apply");
    return;
  }

  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    for (const d of todo.slice(i, i + 400)) batch.update(d.ref, { dueDate: FieldValue.delete() });
    await batch.commit();
  }

  const after = await db.collection("assignments").get();
  const left = after.docs.filter((d) => d.data().dueDate != null).length;
  console.log(`\nbitti. son tarihi kalan: ${left}  (0 olmalı)`);
  if (left > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
