/**
 * Deneme kurslarını ve deneme sertifikalarını siler.
 *
 * Silinenler:
 *   1. Adı "Deneme"/"DENEME" ile başlayan kurslar — alt koleksiyonlarıyla
 *      birlikte (sections, questions, revisions). Firestore doküman silmek
 *      alt koleksiyonu silmiyor; elle dolaşmak şart, yoksa veritabanında
 *      sahipsiz kayıt kalıyor.
 *   2. O kursların bütün atamaları — alt koleksiyonlarıyla (examSessions,
 *      examAttempts, scorm ilerlemesi).
 *   3. Seri numarası --from değerinden büyük/eşit sertifikalar ve her birinin
 *      `certVerify` doğrulama kaydı. Doğrulama kaydı AYRI bir koleksiyonda,
 *      anahtarı sertifikanın verifyToken'ı; unutulursa QR okutulduğunda
 *      silinmiş bir belgeye ait kayıt dönmeye devam eder.
 *   4. Silinen kurslara yapılan yetki referansları (jobTitles.requiredCourseIds
 *      ve subScopes içindekiler) — kalırsa matris olmayan bir kursu zorunlu
 *      tutmaya devam eder.
 *
 * Sertifika sayacı en küçük silinen numaraya geri çekilir ki numaralar
 * boşluksuz devam etsin.
 *
 * Kullanım:
 *   node scripts/delete-test-data.js --from 26-138
 *   node scripts/delete-test-data.js --from 26-138 --apply
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const fromArg = process.argv[process.argv.indexOf("--from") + 1];
if (!fromArg || !/^\d{2}-\d+$/.test(fromArg)) {
  console.error("Kullanım: node scripts/delete-test-data.js --from 26-138 [--apply]");
  process.exit(1);
}

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

/** Seri numarasını sıralanabilir sayıya çevirir: yıl * 1e6 + numara. */
const key = (s) => {
  const m = /^(\d{2})-(\d+)$/.exec(String(s || ""));
  return m ? Number(m[1]) * 1e6 + Number(m[2]) : -1;
};

/** Alt koleksiyonlarıyla birlikte siler. */
async function deleteDeep(ref, subs) {
  for (const name of subs) {
    const snap = await ref.collection(name).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await ref.delete();
}

(async () => {
  const limit = key(fromArg);

  // ---- 1. Deneme kursları
  const courses = (await db.collection("courses").get()).docs.filter((d) =>
    /^deneme\b/i.test(String(d.data().title || ""))
  );
  const courseIds = new Set(courses.map((c) => c.id));

  // ---- 2. Atamaları
  const assignments = (await db.collection("assignments").get()).docs.filter((d) =>
    courseIds.has(d.data().courseId)
  );

  // ---- 3. Sertifikalar
  const certs = (await db.collection("certificates").get()).docs.filter(
    (d) => key(d.data().serialNo) >= limit || courseIds.has(d.data().courseId)
  );

  // ---- 4. Yetki referansları
  const titles = await db.collection("jobTitles").get();
  const titleFix = [];
  for (const t of titles.docs) {
    const d = t.data();
    const req = (d.requiredCourseIds ?? []).filter((id) => courseIds.has(id));
    const subs = (d.subScopes ?? []).filter(
      (s) =>
        (s.requiredCourseIds ?? []).some((id) => courseIds.has(id)) ||
        (s.excludedCourseIds ?? []).some((id) => courseIds.has(id))
    );
    if (req.length || subs.length) titleFix.push({ ref: t.ref, name: d.name, d });
  }

  // ---- 5. Bu kurslara bağlı dış eğitim kayıtları (varsa bağ koparılır, kayıt kalır)
  const externals = (await db.collection("externalTrainings").get()).docs.filter((d) =>
    courseIds.has(d.data().courseId)
  );

  console.log(`KURS (${courses.length}):`);
  for (const c of courses) console.log(`  - ${c.data().title}`);
  console.log(`\nATAMA (${assignments.length}):`);
  for (const a of assignments)
    console.log(`  - ${a.data().courseTitle} · ${a.data().status} · ${a.id.slice(0, 10)}…`);
  console.log(`\nSERTIFIKA (${certs.length}):`);
  for (const c of [...certs].sort((a, b) => key(a.data().serialNo) - key(b.data().serialNo)))
    console.log(
      `  - ${String(c.data().serialNo).padEnd(8)} ${(c.data().userName || "—").padEnd(18)} ${c.data().courseTitle}`
    );
  console.log(`\nYETKI REFERANSI (${titleFix.length}): ${titleFix.map((t) => t.name).join(", ") || "-"}`);
  console.log(`BAGI KOPARILACAK DIS KAYIT (${externals.length})`);

  const lowest = certs.length
    ? Math.min(...certs.map((c) => key(c.data().serialNo)).filter((k) => k > 0))
    : null;
  const nextNo = lowest ? lowest % 1e6 : null;
  console.log(`\nSAYAC: next → ${nextNo ?? "degismiyor"}`);

  if (!APPLY) {
    console.log("\n(dry run — silmek için --apply)");
    return;
  }

  // ---- Silme
  for (const c of certs) {
    const token = c.data().verifyToken;
    if (token) await db.doc(`certVerify/${token}`).delete();
    await c.ref.delete();
  }
  for (const a of assignments) await deleteDeep(a.ref, ["examSessions", "examAttempts", "scorm"]);
  for (const c of courses) await deleteDeep(c.ref, ["sections", "questions", "revisions"]);
  for (const t of titleFix) {
    const d = t.d;
    await t.ref.update({
      requiredCourseIds: (d.requiredCourseIds ?? []).filter((id) => !courseIds.has(id)),
      subScopes: (d.subScopes ?? []).map((s) => ({
        ...s,
        requiredCourseIds: (s.requiredCourseIds ?? []).filter((id) => !courseIds.has(id)),
        excludedCourseIds: (s.excludedCourseIds ?? []).filter((id) => !courseIds.has(id)),
      })),
    });
  }
  // Dış kayıt SİLİNMEZ: kişinin gerçekten aldığı bir eğitim olabilir, yalnızca
  // artık var olmayan kursa olan bağı koparılır.
  for (const e of externals) await e.ref.update({ courseId: null, courseTitle: null });

  if (nextNo) {
    const ctr = await db.doc("counters/certificates").get();
    await ctr.ref.set({ ...(ctr.data() || {}), next: nextNo }, { merge: true });
  }

  console.log(
    `\nSilindi: ${courses.length} kurs, ${assignments.length} atama, ${certs.length} sertifika.`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
