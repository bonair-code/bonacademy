/**
 * "NDT Staff" yetki kapsamını ayrı bir kapsam olarak oluşturur.
 *
 * NDT personeli release (servise verme) yetkisi kullanmıyor; Certifying
 * Staff'ın alt yetkisi olarak modellendiğinde o kapsamın BÜTÜN zorunlu
 * eğitimlerini — İngilizce sınavı dahil — devralıyordu.
 *
 * Başlangıç listesi Certifying Staff'tan İngilizce sınavı çıkarılarak ve NDT
 * eğitimi eklenerek ÖNERİ olarak kuruluyor. Kapsam kimseye atanmadığı sürece
 * hiçbir uygunluk sonucunu değiştirmez — listeyi Settings'ten gözden geçirip
 * öyle ata.
 *
 *   node scripts/create-ndt-scope.js            → dry run
 *   node scripts/create-ndt-scope.js --apply    → oluşturur
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const SOURCE_SCOPE = "Certifying Staff";
const NEW_SCOPE = "NDT Staff";
/** Bu eğitim yeni kapsama TAŞINMAZ — release yetkisi olmayanda gerekmiyor. */
const DROP = ["English Exam"];
/** Alt yetkiden gelen, NDT'ye özgü eğitim. */
const ADD = ["NDT training on the related testing type"];

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  const courses = new Map(
    (await db.collection("courses").get()).docs.map((d) => [d.data().title, d.id])
  );
  const scopes = await db.collection("jobTitles").get();

  if (scopes.docs.some((d) => d.data().name === NEW_SCOPE)) {
    console.log(NEW_SCOPE + " zaten var, dokunulmadı.");
    return;
  }
  const src = scopes.docs.find((d) => d.data().name === SOURCE_SCOPE);
  if (!src) throw new Error(SOURCE_SCOPE + " bulunamadı.");

  const titleOf = new Map([...courses.entries()].map(([t, id]) => [id, t]));
  const dropIds = DROP.map((t) => courses.get(t)).filter(Boolean);
  const addIds = ADD.map((t) => courses.get(t)).filter(Boolean);

  const required = Array.from(
    new Set([
      ...(src.data().requiredCourseIds ?? []).filter((id) => !dropIds.includes(id)),
      ...addIds,
    ])
  );

  console.log(NEW_SCOPE + " — önerilen zorunlu eğitimler (" + required.length + "):");
  required.forEach((id) => console.log("   -", titleOf.get(id) ?? id));
  console.log("\nÇıkarılan:");
  DROP.forEach((t) => console.log("   -", t, courses.get(t) ? "" : "(kurs bulunamadı!)"));

  if (!APPLY) {
    console.log("\n[dry run] Oluşturulmadı. Yazmak için: --apply");
    return;
  }
  const ref = await db.collection("jobTitles").add({
    name: NEW_SCOPE,
    requiredCourseIds: required,
    subScopes: [],
  });
  console.log("\noluşturuldu:", ref.id);
  console.log(
    "Kapsam henüz kimsede yok — Users'tan atayana kadar hiçbir uygunluk sonucu değişmez."
  );
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
