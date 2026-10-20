/**
 * storage.cors.json dosyasını Storage kovasına uygular.
 *
 * Kovanın CORS ayarı `firebase deploy` ile GİTMİYOR — storage.rules dağıtılıyor
 * ama CORS kova meta verisi, ayrı uygulanması gerekiyor. Bu yüzden ayar uzun
 * süre yalnızca kovada duruyordu, depoda hiçbir izi yoktu; yeni alan adı
 * bağlanınca kimse hatırlamadı ve bütün PDF/SCORM dosyaları "Failed to fetch"
 * oldu. Hata yalnızca tarayıcı konsolunda görünüyor, ekranda sebebi yazmıyor.
 *
 * Kullanım:
 *   node scripts/apply-storage-cors.js            → mevcut ayarı gösterir
 *   node scripts/apply-storage-cors.js --apply    → dosyadakini uygular
 */
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getStorage } = fnRequire("firebase-admin/storage");

const APPLY = process.argv.includes("--apply");
const BUCKET = "bonair-academy.firebasestorage.app";

initializeApp({ projectId: "bonair-academy", storageBucket: BUCKET });

(async () => {
  const bucket = getStorage().bucket();
  const want = JSON.parse(fs.readFileSync(path.join(__dirname, "../storage.cors.json"), "utf8"));

  const [md] = await bucket.getMetadata();
  console.log(`Kova: ${md.name}\n`);
  console.log("ŞU ANKİ izinli adresler:");
  for (const r of md.cors ?? []) console.log("  " + (r.origin ?? []).join("\n  "));

  console.log("\nDOSYADAKİ izinli adresler:");
  for (const r of want) console.log("  " + (r.origin ?? []).join("\n  "));

  const current = new Set((md.cors ?? []).flatMap((r) => r.origin ?? []));
  const missing = want.flatMap((r) => r.origin ?? []).filter((o) => !current.has(o));
  console.log(`\nEksik: ${missing.length ? missing.join(", ") : "yok"}`);

  if (!APPLY) {
    console.log("\n(uygulamak için --apply)");
    return;
  }
  // `//` açıklama alanı Google API'sine gönderilmemeli.
  await bucket.setCorsConfiguration(want.map(({ ["//"]: _note, ...rule }) => rule));
  const [after] = await bucket.getMetadata();
  console.log("\nUygulandı. Yeni liste:");
  for (const r of after.cors ?? []) console.log("  " + (r.origin ?? []).join("\n  "));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
