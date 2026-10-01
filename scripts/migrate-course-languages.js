/**
 * Dil sürümlerine geçiş.
 *
 * Eğitim artık tek kayıt ama içinde DİL SÜRÜMLERİ var: her sürümün kendi
 * bölümleri, kendi soru bankası ve kendi yayın durumu. Var olan bütün içerik
 * Türkçe sayılır — sistem bugüne kadar tek dilliydi.
 *
 * Yapılanlar:
 *   1. `lang` alanı olmayan her bölüm ve soru → lang: "TR"
 *   2. Yayında (isActive !== false) ve Türkçe içeriği olan kurs
 *      → publishedLangs: ["TR"]
 *   3. Yayında ama içeriği olmayan kurs → publishedLangs: [], isActive: false
 *      (zaten normalize-course-active ile kapatılmıştı, burada teyit)
 *
 * EXTERNAL_ONLY (takip edilen dış eğitim) dil taşımaz: içeriği bizde değil.
 * Ona publishedLangs yazılmaz, isActive'ine dokunulmaz.
 *
 * Kullanım:
 *   node scripts/migrate-course-languages.js            → dry run
 *   node scripts/migrate-course-languages.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

/** functions/src/index.ts'teki sectionHasContent ile aynı kural. */
function sectionHasContent(s) {
  if (Array.isArray(s.contents)) return s.contents.length > 0;
  return s.content != null;
}

(async () => {
  const courses = await db.collection("courses").get();

  let secTagged = 0;
  let qTagged = 0;
  const publish = [];
  const close = [];
  const skipped = [];

  for (const doc of courses.docs) {
    const c = doc.data();
    if ((c.delivery ?? "ONLINE") === "EXTERNAL_ONLY") {
      skipped.push(c.title);
      continue;
    }

    const [secs, qs] = await Promise.all([
      doc.ref.collection("sections").get(),
      doc.ref.collection("questions").get(),
    ]);

    const untaggedSecs = secs.docs.filter((d) => !d.data().lang);
    const untaggedQs = qs.docs.filter((d) => !d.data().lang);
    secTagged += untaggedSecs.length;
    qTagged += untaggedQs.length;

    const trFilled = secs.docs.filter(
      (d) => (d.data().lang ?? "TR") === "TR" && sectionHasContent(d.data())
    ).length;

    if (c.isActive !== false && trFilled > 0) {
      publish.push({ id: doc.id, title: c.title, sections: secs.size, filled: trFilled });
    } else {
      close.push({ id: doc.id, title: c.title, active: c.isActive !== false, filled: trFilled });
    }

    if (APPLY) {
      for (let i = 0; i < untaggedSecs.length; i += 400) {
        const batch = db.batch();
        for (const d of untaggedSecs.slice(i, i + 400)) batch.update(d.ref, { lang: "TR" });
        await batch.commit();
      }
      for (let i = 0; i < untaggedQs.length; i += 400) {
        const batch = db.batch();
        for (const d of untaggedQs.slice(i, i + 400)) batch.update(d.ref, { lang: "TR" });
        await batch.commit();
      }
      await doc.ref.update({
        publishedLangs: c.isActive !== false && trFilled > 0 ? ["TR"] : [],
        isActive: c.isActive !== false && trFilled > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`${courses.size} kurs tarandı.\n`);
  console.log(`Türkçe etiketlenecek: ${secTagged} bölüm, ${qTagged} soru\n`);

  console.log(`publishedLangs: ["TR"] olacak — ${publish.length} kurs`);
  for (const c of publish)
    console.log(`  - ${c.title}  (${c.filled}/${c.sections} bölümde içerik)`);

  console.log(`\npublishedLangs: [] kalacak — ${close.length} kurs`);
  for (const c of close)
    console.log(`  - ${c.title}  (${c.active ? "yayındaydı" : "taslak"}, içerikli bölüm: ${c.filled})`);

  console.log(`\nDil taşımayan (EXTERNAL_ONLY): ${skipped.length}`);

  if (!APPLY) console.log("\n(dry run — yazmak için --apply)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
