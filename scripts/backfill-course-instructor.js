/**
 * Mevcut kurslara eğitmen adını yazar.
 *
 * Öğrenci kartında "Instructor: …" satırı kurs dokümanından okunuyor; müşteri
 * rolü `users` koleksiyonunu okuyamadığı için isme başka yoldan ulaşamıyor.
 * Yeni kurslar bu alanı oluşturulurken alıyor, eskiler bu script ile.
 *
 *   node scripts/backfill-course-instructor.js            → dry run
 *   node scripts/backfill-course-instructor.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  const users = new Map(
    (await db.collection("users").get()).docs.map((d) => [d.id, d.data().name || null])
  );
  const courses = await db.collection("courses").get();

  let n = 0;
  for (const c of courses.docs) {
    const x = c.data();
    if (x.ownerInstructorName) continue;
    const name = x.ownerInstructorId ? users.get(x.ownerInstructorId) ?? null : null;
    if (!name) {
      console.log("  eğitmen yok:", x.title);
      continue;
    }
    console.log((APPLY ? "yazılıyor" : "[dry]") + " " + x.title + " → " + name);
    if (APPLY) await c.ref.update({ ownerInstructorName: name });
    n++;
  }
  console.log("\n" + (APPLY ? "güncellenen" : "güncellenecek") + " kurs: " + n);
  if (!APPLY) console.log("Yazmak için: --apply");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
