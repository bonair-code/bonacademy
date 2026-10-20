/**
 * `courses.isActive` alanını netleştirir ve içi boş yayınları kapatır.
 *
 * İki ayrı belirsizlik vardı:
 *   1. Alan hiç yoksa editör "yayında" sayıyordu (`data.isActive ?? true`),
 *      liste ekranı ise `isActive === false` olmayanı yayında sayıyordu.
 *      Artık her kursta alan açıkça yazılı.
 *   2. Bölümü olmayan ya da bölümleri boş kabuk olan kurslar yayında kalmıştı;
 *      atanan kişi /learn'de hiç ilerleyemiyor (tamamla düğmesi çıkmıyor,
 *      durum PENDING'de donuyor).
 *
 * EXTERNAL_ONLY (takip edilen dış eğitim) istisna — içeriği bizde değil.
 *
 * Atamalar SİLİNMEZ (havacılık eğitim kaydı); etkilenenler raporlanır.
 *
 * Kullanım:
 *   node scripts/normalize-course-active.js            → dry run
 *   node scripts/normalize-course-active.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

/** Bölümün gerçekten materyali var mı? (functions/src/index.ts ile aynı kural) */
function sectionHasContent(s) {
  if (Array.isArray(s.contents)) return s.contents.length > 0;
  return s.content != null;
}

(async () => {
  const courses = await db.collection("courses").get();
  const assignments = await db.collection("assignments").get();

  const openByCourse = new Map();
  for (const a of assignments.docs) {
    const d = a.data();
    if (["COMPLETED", "EXAM_PASSED"].includes(d.status)) continue;
    const list = openByCourse.get(d.courseId) ?? [];
    list.push(d.userId);
    openByCourse.set(d.courseId, list);
  }

  const toClose = [];
  const toStamp = [];

  for (const doc of courses.docs) {
    const c = doc.data();
    const external = (c.delivery ?? "ONLINE") === "EXTERNAL_ONLY";
    const published = c.isActive !== false; // alan yoksa bugünkü davranış
    let filled = 0;
    let sections = 0;
    if (!external) {
      const snap = await doc.ref.collection("sections").get();
      sections = snap.size;
      filled = snap.docs.filter((s) => sectionHasContent(s.data())).length;
    }
    const empty = !external && filled === 0;

    if (published && empty) {
      toClose.push({
        id: doc.id,
        title: c.title,
        sections,
        filled,
        open: openByCourse.get(doc.id) ?? [],
      });
    } else if (c.isActive === undefined) {
      toStamp.push({ id: doc.id, title: c.title, value: published });
    }
  }

  console.log(`${courses.size} kurs tarandı.\n`);

  console.log(`Yayından alınacak (içi boş): ${toClose.length}`);
  for (const c of toClose) {
    console.log(
      `  - ${c.title}\n      bölüm: ${c.sections}, içeriği olan: ${c.filled}` +
        (c.open.length ? `\n      ⚠ açık atama: ${c.open.length} kişi (silinmiyor)` : "")
    );
  }

  console.log(`\nisActive alanı yazılacak (alan eksik): ${toStamp.length}`);
  for (const c of toStamp) console.log(`  - ${c.title} → ${c.value}`);

  if (!APPLY) {
    console.log("\n(dry run — yazmak için --apply)");
    return;
  }

  let n = 0;
  for (const c of toClose) {
    await db.doc(`courses/${c.id}`).update({
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    n++;
  }
  for (const c of toStamp) {
    await db.doc(`courses/${c.id}`).update({ isActive: c.value });
    n++;
  }
  console.log(`\n${n} kurs güncellendi.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
