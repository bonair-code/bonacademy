/**
 * `externalTrainings` ve `certificates` kayıtlarındaki `userDepartmentId`
 * alanını kişinin güncel departmanından doldurur.
 *
 * Neden: güvenlik kuralı müdürün sorgusunu departmana göre daraltıyor
 * (`where("userDepartmentId","==",myDept)`), çünkü kapsamsız sorgu komple
 * reddediliyor. Alanı boş olan kayıt bu sorguya HİÇ düşmüyor — kayıt duruyor
 * ama müdür göremiyor.
 *
 * Sonucu ağır: Training Follow-Up matrisi müdüre, aslında eğitimi almış olan
 * personeli "hiç alınmamış" gösteriyordu. Ekran yanlış tabloyu doğruymuş gibi
 * sunuyordu — bu projede aynı sınıftan dördüncü hata.
 *
 * Kâğıt matristen aktarılan 464 kayıtta alan hiç yazılmamıştı; sonradan
 * arayüzden girilenlerde yazılıyor.
 *
 * NOT: alan denormalize. Kişi departman değiştirirse kayıtlar eskide kalır;
 * o yüzden departman değişiminde bu script yeniden koşturulmalı (ya da
 * updateUser kayıtları da güncellemeli — ayrı iş).
 *
 * Kullanım:
 *   node scripts/backfill-record-department.js            → dry run
 *   node scripts/backfill-record-department.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

(async () => {
  const users = new Map(
    (await db.collection("users").get()).docs.map((d) => [d.id, d.data()])
  );

  let total = 0;
  for (const col of ["externalTrainings", "certificates"]) {
    const snap = await db.collection(col).get();
    const fix = [];
    const orphan = [];

    for (const d of snap.docs) {
      const x = d.data();
      const u = users.get(x.userId);
      if (!u) {
        orphan.push(d.id);
        continue;
      }
      const want = u.departmentId ?? null;
      if ((x.userDepartmentId ?? null) !== want) fix.push({ ref: d.ref, want, name: u.name });
    }

    console.log(`${col}: ${snap.size} kayıt, düzeltilecek ${fix.length}, sahipsiz ${orphan.length}`);
    // Kaç kişiyi etkilediğini göster — sayı tek başına anlam taşımıyor.
    const byName = new Map();
    for (const f of fix) byName.set(f.name, (byName.get(f.name) ?? 0) + 1);
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  ${byName.size} kişi etkileniyor; en çok: ${top.map(([n, c]) => `${n} (${c})`).join(", ")}`);

    if (APPLY) {
      for (let i = 0; i < fix.length; i += 400) {
        const batch = db.batch();
        for (const f of fix.slice(i, i + 400))
          batch.update(f.ref, { userDepartmentId: f.want });
        await batch.commit();
      }
    }
    total += fix.length;
  }

  console.log(`\n${APPLY ? `${total} kayıt güncellendi.` : "(dry run — yazmak için --apply)"}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
