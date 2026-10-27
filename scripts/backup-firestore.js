/**
 * Firestore'un tamamını JSON'a yazar — silmeden önceki güvenlik ağı.
 *
 * HİÇBİR ŞEY DEĞİŞTİRMEZ, yalnızca okur. Her koleksiyon ayrı bir dosya;
 * Timestamp alanları {__ts: "ISO"} olarak saklanır ki geri yüklenebilsin.
 *
 * Kullanım:
 *   node scripts/backup-firestore.js <hedef-klasör>
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, Timestamp } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const OUT = process.argv[2];
if (!OUT) {
  console.error("Hedef klasör gerekli: node scripts/backup-firestore.js <klasör>");
  process.exit(1);
}

/** Timestamp ve referansları JSON'da taşınabilir hâle getirir. */
function plain(v) {
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object" && v.constructor === Object) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cols = await db.listCollections();
  const summary = [];
  for (const c of cols) {
    const snap = await c.get();
    const docs = snap.docs.map((d) => ({ __id: d.id, ...plain(d.data()) }));
    const file = path.join(OUT, `${c.id}.json`);
    fs.writeFileSync(file, JSON.stringify(docs, null, 1), "utf8");
    summary.push([c.id, docs.length, fs.statSync(file).size]);
  }
  const total = summary.reduce((a, b) => a + b[1], 0);
  console.log(`yedek: ${OUT}`);
  summary
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, n, b]) => console.log(`  ${String(n).padStart(5)}  ${id.padEnd(20)} ${(b / 1024).toFixed(0)} KB`));
  console.log(`\ntoplam ${total} doküman, ${summary.length} koleksiyon`);

  // Kendini doğrula: dosyaları geri oku, sayılar tutuyor mu?
  let bad = 0;
  for (const [id, n] of summary) {
    const back = JSON.parse(fs.readFileSync(path.join(OUT, `${id}.json`), "utf8"));
    if (back.length !== n) {
      console.log(`  ! ${id}: yazılan ${n}, geri okunan ${back.length}`);
      bad++;
    }
  }
  console.log(bad === 0 ? "doğrulama: tamam" : `doğrulama: ${bad} koleksiyonda sapma`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
