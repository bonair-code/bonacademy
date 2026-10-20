/**
 * CAPELLA aktarımı — canlıya almadan ÖNCE okunacak durum raporu.
 *
 * HİÇBİR ŞEY YAZMAZ. Yalnızca okur ve "deploy sonrası neyin bozulacağını"
 * sayılarla gösterir. Yazma işlerini onay alındıktan sonra ayrı betikler yapar.
 *
 * Kullanım: node scripts/preflight-aktarim.js
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const head = (t) => console.log("\n" + "═".repeat(64) + "\n" + t + "\n" + "─".repeat(64));

async function main() {
  // ── a. Sertifikalarda `blocked` alanı ────────────────────────────────
  head("a) SERTİFİKALAR — `blocked` alanı");
  const certs = await db.collection("certificates").get();
  const noBlocked = [];
  const hasBlocked = { true: 0, false: 0 };
  for (const d of certs.docs) {
    const c = d.data();
    if (c.blocked === undefined) noBlocked.push({ id: d.id, assignmentId: c.assignmentId ?? null, serialNo: c.serialNo ?? "" });
    else hasBlocked[String(!!c.blocked)]++;
  }
  console.log(`toplam sertifika         : ${certs.size}`);
  console.log(`blocked alanı VAR        : ${hasBlocked.false} (false) + ${hasBlocked.true} (true)`);
  console.log(`blocked alanı YOK        : ${noBlocked.length}  ← sahibi göremez`);
  if (noBlocked.length) {
    console.log("ilk 5 örnek:");
    for (const c of noBlocked.slice(0, 5)) console.log(`  ${c.serialNo || "(no)"}  ${c.id}`);
  }

  // Bağlı atamada erişim kapalı olanlar → blocked: true olmalı
  const asg = await db.collection("assignments").get();
  const blockedAsg = new Set(asg.docs.filter((d) => d.data().accessBlocked === true).map((d) => d.id));
  const shouldBlock = noBlocked.filter((c) => c.assignmentId && blockedAsg.has(c.assignmentId));
  console.log(`bunlardan erişimi kapalı : ${shouldBlock.length}  → blocked: true yazılacak`);
  console.log(`geri kalan               : ${noBlocked.length - shouldBlock.length}  → blocked: false`);

  // ── b. Atamalarda dueDate ────────────────────────────────────────────
  head("b) ATAMALAR — `dueDate`");
  const withDue = asg.docs.filter((d) => d.data().dueDate != null);
  console.log(`toplam atama             : ${asg.size}`);
  console.log(`son tarihi olan          : ${withDue.length}  ← silinecek (kullanıcı kararı)`);
  const open = withDue.filter((d) => !["COMPLETED", "EXAM_PASSED", "CANCELLED"].includes(d.data().status));
  console.log(`  bunlardan açık olan    : ${open.length}`);
  console.log(`  bitmiş/iptal olan      : ${withDue.length - open.length}`);

  // ── c. Departmansız müdürler ─────────────────────────────────────────
  head("c) MÜDÜRLER — eksik `departmentId`");
  const users = await db.collection("users").get();
  const mgrs = users.docs.filter((d) => d.data().role === "MANAGER");
  const noDept = mgrs.filter((d) => !d.data().departmentId);
  console.log(`MANAGER sayısı           : ${mgrs.length}`);
  console.log(`departmanı boş olan      : ${noDept.length}  ← yetkisi çalışmaz`);
  for (const d of noDept) {
    const u = d.data();
    console.log(`  ${u.name || "(adsız)"}  ${u.email || ""}  aktif:${u.isActive !== false}`);
  }

  // ── d. Atama kimliği biçimi ──────────────────────────────────────────
  head("d) ATAMA KİMLİĞİ — `{uid}_{courseId}` kalıbı");
  const badId = [];
  for (const d of asg.docs) {
    const a = d.data();
    if (!a.userId || !a.courseId) {
      badId.push({ id: d.id, why: "userId/courseId eksik" });
      continue;
    }
    const expected = `${a.userId}_${a.courseId}`;
    // Yenileme döngüleri `_c2` gibi bir ek alabiliyor — o da kalıba uyuyor.
    if (d.id !== expected && !d.id.startsWith(expected + "_")) badId.push({ id: d.id, why: `beklenen ${expected}` });
  }
  console.log(`kalıba uymayan atama     : ${badId.length}`);
  for (const b of badId.slice(0, 10)) console.log(`  ${b.id}  (${b.why})`);

  // ── e. Sertifika sayacı ──────────────────────────────────────────────
  head("e) SERTİFİKA SAYACI — `counters/certificates`");
  const ctr = await db.doc("counters/certificates").get();
  if (!ctr.exists) console.log("belge YOK — ilk sertifikada oluşur");
  else console.log(JSON.stringify(ctr.data(), null, 2));
  // Canlı verideki en büyük numara: sayaç bunun gerisinde kalmamalı.
  let maxKey = 0;
  let maxSerial = "";
  for (const d of certs.docs) {
    const s = String(d.data().serialNo || "");
    const m = /^(\d{2})-(\d+)$/.exec(s);
    if (!m) continue;
    const k = Number(m[1]) * 1e6 + Number(m[2]);
    if (k > maxKey) {
      maxKey = k;
      maxSerial = s;
    }
  }
  console.log(`veride en büyük numara   : ${maxSerial || "(yok)"}`);

  // ── f. Yarım kalmış sınavlar ─────────────────────────────────────────
  head("f) SÜREN SINAVLAR — `examSessions`");
  const ex = await db.collection("examSessions").get();
  const live = ex.docs.filter((d) => {
    const e = d.data();
    return !e.submittedAt && e.status !== "SUBMITTED" && e.status !== "EXPIRED";
  });
  console.log(`toplam sınav oturumu     : ${ex.size}`);
  console.log(`yarıda kalmış / açık     : ${live.length}`);
  for (const d of live.slice(0, 15)) {
    const e = d.data();
    const started = e.startedAt?.toDate?.();
    console.log(
      `  ${d.id}  başlangıç:${started ? started.toISOString().slice(0, 16).replace("T", " ") : "?"}  durum:${e.status ?? "-"}  döngü:${e.cycleNumber ?? "-"}`
    );
  }
  if (live.length === 0) console.log("  → kimse sınavda değil, istediğin saatte canlıya alabilirsin.");

  console.log("\n" + "═".repeat(64));
  console.log("Bu betik HİÇBİR ŞEY YAZMADI.");
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
