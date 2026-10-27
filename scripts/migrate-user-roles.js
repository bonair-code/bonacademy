/**
 * Tek `role` → çoklu `roles`.
 *
 * Her kullanıcıya `roles: [role]` yazar ve custom claim'i tazeler.
 *
 * ZORUNLU DEĞİL: hem güvenlik kuralları hem istemci, `roles` yoksa tek
 * `role` alanına düşüyor. Bu betik yalnızca veriyi ve jetonları tek biçime
 * getiriyor — koşulmazsa da sistem doğru çalışır.
 *
 * Kullanım:
 *   node scripts/migrate-user-roles.js           → yalnızca rapor (yazmaz)
 *   node scripts/migrate-user-roles.js --apply   → yazar
 *
 * --apply çalıştırıldığında ilgili kişilerin oturum jetonu yenilenir:
 * açık oturumlar bir sonraki istekte yeni rol listesini görür.
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");
const { getAuth } = fnRequire("firebase-admin/auth");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();
const auth = getAuth();

const APPLY = process.argv.includes("--apply");
const ROLES = ["ADMIN", "MANAGER", "INSTRUCTOR", "USER", "CUSTOMER"];

/** CUSTOMER tek başınadır; personel rolleri birleşebilir. */
function normalize(roles, role) {
  const raw = Array.isArray(roles) && roles.length ? roles.map(String) : role ? [String(role)] : [];
  const kept = ROLES.filter((r) => raw.includes(r));
  if (kept.length === 0) return ["USER"];
  const staff = kept.filter((r) => r !== "CUSTOMER");
  return staff.length > 0 ? staff : ["CUSTOMER"];
}
const primaryOf = (roles) => ROLES.find((r) => roles.includes(r)) ?? "USER";

async function main() {
  const snap = await db.collection("users").get();
  const todo = [];
  const tally = new Map();

  for (const d of snap.docs) {
    const v = d.data();
    const next = normalize(v.roles, v.role);
    const key = next.join("+");
    tally.set(key, (tally.get(key) ?? 0) + 1);
    const already = Array.isArray(v.roles) && JSON.stringify(v.roles) === JSON.stringify(next);
    if (!already || v.role !== primaryOf(next))
      todo.push({ id: d.id, name: v.name ?? d.id, from: v.role ?? "(yok)", to: next });
  }

  console.log(`kullanıcı: ${snap.size}`);
  console.log("rol dağılımı:");
  [...tally].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));
  console.log(`\nyazılacak kayıt: ${todo.length}`);
  todo.slice(0, 10).forEach((t) => console.log(`  - ${t.name}: ${t.from} → [${t.to.join(", ")}]`));
  if (todo.length > 10) console.log(`  … ve ${todo.length - 10} kişi daha`);

  if (!APPLY) {
    console.log("\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için: --apply");
    return;
  }

  let claimFail = 0;
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    for (const t of todo.slice(i, i + 400))
      batch.update(db.doc(`users/${t.id}`), { roles: t.to, role: primaryOf(t.to) });
    await batch.commit();
  }
  for (const t of todo) {
    try {
      const u = await auth.getUser(t.id);
      await auth.setCustomUserClaims(t.id, {
        ...(u.customClaims ?? {}),
        role: primaryOf(t.to),
        roles: t.to,
      });
    } catch {
      // Auth hesabı olmayan kayıt (yalnızca Firestore'da duran) olabilir.
      claimFail++;
    }
  }
  console.log(`\nyazıldı: ${todo.length}   claim yazılamayan: ${claimFail}`);

  // Kendini doğrula: tek tek geri oku.
  const after = await db.collection("users").get();
  const bad = after.docs.filter((d) => {
    const v = d.data();
    return !Array.isArray(v.roles) || v.roles.length === 0 || v.role !== primaryOf(v.roles);
  });
  console.log(`doğrulama — eksik kalan: ${bad.length}`);
  bad.slice(0, 5).forEach((d) => console.log("  -", d.data().name ?? d.id));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
