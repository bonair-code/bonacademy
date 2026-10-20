/**
 * Eski sertifikalara `blocked` alanını yazar.
 *
 * NEDEN ŞART: hem kural hem sorgu `blocked == false` istiyor
 * (firestore.rules "match /certificates", Certificates.tsx, StaffDetail.tsx).
 * Firestore'da OLMAYAN alan bu karşılaştırmayı geçmez — alanı olmayan
 * sertifikayı sahibi göremez ve sorgu onu hiç döndürmez. Canlıdaki 244
 * sertifikanın hiçbirinde alan yok, yani bu betik koşmadan yeni sürüm
 * yayına alınırsa HERKESİN "My Certificates" ekranı boşalır.
 *
 * SIRA: bu betik, kurallar VE hosting canlıya alınmadan ÖNCE koşar.
 *
 * Değer nereden geliyor: bağlı atamada `accessBlocked == true` ise
 * `blocked: true` (yönetici erişimi kapatmış), değilse `false`.
 * Alanı zaten olan belgeye DOKUNULMAZ.
 *
 * Kullanım:
 *   node scripts/backfill-cert-blocked.js            → kuru çalıştırma
 *   node scripts/backfill-cert-blocked.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

async function main() {
  const [certs, asg] = await Promise.all([
    db.collection("certificates").get(),
    db.collection("assignments").get(),
  ]);
  const blockedAsg = new Set(asg.docs.filter((d) => d.data().accessBlocked === true).map((d) => d.id));

  const todo = [];
  for (const d of certs.docs) {
    const c = d.data();
    if (c.blocked !== undefined) continue;
    const blocked = !!(c.assignmentId && blockedAsg.has(c.assignmentId));
    todo.push({ ref: d.ref, id: d.id, serialNo: c.serialNo ?? "", blocked });
  }

  const t = todo.filter((x) => x.blocked).length;
  console.log(`sertifika toplam        : ${certs.size}`);
  console.log(`alanı zaten olan        : ${certs.size - todo.length}  (dokunulmaz)`);
  console.log(`yazılacak               : ${todo.length}  → ${todo.length - t} kez false, ${t} kez true`);
  if (t > 0) {
    console.log("blocked: true yazılacaklar (erişimi kapalı atamalar):");
    for (const x of todo.filter((y) => y.blocked)) console.log(`  ${x.serialNo}  ${x.id}`);
  }
  console.log("ilk 5 örnek:", todo.slice(0, 5).map((x) => x.serialNo || x.id).join(", "));

  if (!APPLY) {
    console.log("\nKURU ÇALIŞTIRMA — hiçbir şey yazılmadı. Yazmak için: --apply");
    return;
  }

  let n = 0;
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    for (const x of todo.slice(i, i + 400)) batch.update(x.ref, { blocked: x.blocked });
    await batch.commit();
    n += Math.min(400, todo.length - i);
    console.log(`  yazıldı: ${n}/${todo.length}`);
  }

  // Doğrulama: alanı eksik belge kalmamalı.
  const after = await db.collection("certificates").get();
  const left = after.docs.filter((d) => d.data().blocked === undefined).length;
  console.log(`\nbitti. alanı hâlâ eksik olan: ${left}  (0 olmalı)`);
  if (left > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
