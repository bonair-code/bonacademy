/**
 * Deneme çalıştırmalarının artıklarını temizler.
 *
 * Sertifikaları `delete-test-certificates.js` sildi; geriye belge üretmediği
 * hâlde "1 sertifika verildi" diyen iki sınıf oturumu ve sertifikası olmadan
 * COMPLETED kalan iki atama kalmıştı.
 *
 * Atamalar SİLİNMEZ, sıfırlanır: atama bir görevdir, kişi eğitimi yeniden
 * alabilsin diye PENDING'e döner. Eğitim kayıtlarını silmek havacılıkta ayrı
 * ve bilinçli bir iş olmalı.
 *
 *   node scripts/cleanup-test-runs.js            → dry run
 *   node scripts/cleanup-test-runs.js --apply    → uygular
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");

/** Deneme sınıf oturumları — tamamen silinir (katılımcılarıyla birlikte). */
const SESSIONS = ["POtPIwYlYQnTIqFlC0RW", "YcLnVPcahsEb98AjFPmv"];
/** Sertifikası silinen atamalar — PENDING'e döner. */
const ASSIGNMENTS = [
  "LXNwfZ9aN4MsIFC6KoCYWjI8WqE2_dUERbzRVWUrIdZu0agYj",
  "LXNwfZ9aN4MsIFC6KoCYWjI8WqE2_kYwYA7zL53MruB5E9rU0",
];

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  for (const sid of SESSIONS) {
    const ref = db.doc(`classSessions/${sid}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log("oturum yok:", sid);
      continue;
    }
    const at = await ref.collection("attendees").get();
    console.log(
      (APPLY ? "siliniyor" : "[dry]") +
        `  oturum ${snap.data().courseTitle} · ${at.size} katılımcı`
    );
    if (!APPLY) continue;
    const batch = db.batch();
    at.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
  }

  for (const aid of ASSIGNMENTS) {
    const ref = db.doc(`assignments/${aid}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log("atama yok:", aid);
      continue;
    }
    console.log(
      (APPLY ? "sıfırlanıyor" : "[dry]") +
        `  atama ${snap.data().courseTitle} (${snap.data().status} → PENDING)`
    );
    if (!APPLY) continue;
    await ref.update({
      status: "PENDING",
      sectionsDone: [],
      completedAt: FieldValue.delete(),
      startedAt: FieldValue.delete(),
      completedVia: FieldValue.delete(),
      certificateId: FieldValue.delete(),
    });
  }

  if (!APPLY) console.log("\n[dry run] Hiçbir şey değişmedi. Uygulamak için: --apply");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
