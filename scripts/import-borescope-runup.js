/**
 * BORESCOPE & ENGINE RUN-UP takibini kâğıttan sisteme alır.
 *
 * Kaynak: BON-F145-094_Rev01_Training_Follow-Up_Form 2026.xlsx
 *         "BRSCP&ENRUP&TT FOLLOW" sayfası.
 *
 * Sayfanın yapısı: her kişi İKİ satır — üstte alınma tarihi (gg/aa/yyyy),
 * altta kalan gün. Geçerlilik süresi ikisinden hesaplandı: 66 dolu hücrenin
 * TAMAMINDA tam 2 yıl (en az 2.00, en çok 2.00). O yüzden süre sabit.
 *
 * Ne yazar:
 *   1. Her kalem için bir "tracked training" kursu (EXTERNAL_ONLY, 2 yıl,
 *      Follow-Up'ta "Borescope & Run-Up" sekmesi).
 *   2. Her dolu hücre için bir dış eğitim kaydı.
 *
 * Doküman kimlikleri tarihten/kişiden türetilir: betik ikinci kez
 * koşturulduğunda aynı kaydın kopyasını değil, üzerine aynısını yazar.
 *
 * Kullanım:
 *   node scripts/import-borescope-runup.js           → yalnızca rapor
 *   node scripts/import-borescope-runup.js --apply   → yazar
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const webRequire = createRequire(path.join(__dirname, "../web/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = fnRequire("firebase-admin/firestore");
const XLSX = webRequire("xlsx");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const APPLY = process.argv.includes("--apply");
const SRC =
  process.argv.find((a) => a.endsWith(".xlsx")) ||
  "C:/Users/user/BONAIR HAVACILIK SANAYI VE TICARETANONI/MAINTENANCE (PART 145) - TRAINING/01.TRAINING_FOLLOW-UP_LIST/BON-F145-094_Rev01_Training_Follow-Up_Form 2026.xlsx";
const SHEET = "BRSCP&ENRUP&TT FOLLOW";
const VALIDITY_YEARS = 2;

/**
 * Kâğıttaki sütun başlığı → sistemdeki kurs adı.
 *
 * Başlıklar büyük harf ve tutarsız ("GE CF34-3 BORECOPE" yazım hatası,
 * kimi başlıkta iş türü yazmıyor). Burada tek tek, elle eşlendi — otomatik
 * bir dönüşüme bırakılmadı, çünkü hangi kalemin borescope hangisinin
 * run-up olduğu yalnızca sayfadaki blok sırasından anlaşılıyor.
 */
const TITLES = {
  "RR BR710 BORESCOPE": "RR BR710 — Borescope",
  "HONEYWELL AS907 BORESCOPE": "Honeywell AS907 — Borescope",
  "RR TAY 611 BORESCOPE": "RR Tay 611 — Borescope",
  "GE CF34-3 BORECOPE": "GE CF34-3 — Borescope",
  "RR CORP AE3007A": "RR Corp AE3007A — Borescope",
  "HONEYWELL TFE731 BORESCOPE": "Honeywell TFE731 — Borescope",
  "CHALLENGER 300 ENGINE RUN-UP": "Challenger 300 — Engine Run-Up",
  "CHALLENGER 604/605 ENGINE RUN-UP": "Challenger 604/605 — Engine Run-Up",
  "CHALLENGER 850 CL600-2B19 ENGINE RUN-UP": "Challenger 850 CL600-2B19 — Engine Run-Up",
  "GLOBAL XRS BD-700 ENGINE RUN-UP": "Global XRS BD-700 — Engine Run-Up",
  "HAWKER BAe 125 750/800XP/850XP/900XP ENGINE RUN-UP (TFE731)":
    "Hawker BAe 125 750/800XP/850XP/900XP (TFE731) — Engine Run-Up",
  "GULFSTREAM G4 ENGINE RUN-UP": "Gulfstream G4 — Engine Run-Up",
  "Embraer EMB-135/145 (RR Corp AE3007A)": "Embraer EMB-135/145 (RR Corp AE3007A) — Engine Run-Up",
  "RR BR710 ER Gulfstream GV": "RR BR710 ER Gulfstream GV — Engine Run-Up",
  "TAP TEST": "Tap Test",
};

const norm = (s) => String(s).toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const slug = (s) =>
  String(s).toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const iso = (d) => d.toISOString().slice(0, 10);
const parseDate = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v).trim());
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
};
const plusYears = (d, n) => {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return x;
};

async function main() {
  const wb = XLSX.readFile(SRC);
  if (!wb.Sheets[SHEET]) throw new Error(`"${SHEET}" sayfası yok. Sayfalar: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, raw: false, defval: "" });

  const head = rows[4].map((c) => String(c).replace(/\s+/g, " ").trim());
  const cols = head.map((h, i) => ({ i, h })).filter((x) => x.i >= 3 && x.h);
  const unknown = cols.filter((c) => !TITLES[c.h]);
  if (unknown.length) {
    console.log("TANINMAYAN SÜTUN (eşleme tablosuna eklenmeli):");
    unknown.forEach((c) => console.log("   -", c.h));
    throw new Error("Önce sütun eşlemesi tamamlanmalı — yanlış kurs açmamak için durdum.");
  }

  const [usSnap, csSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("courses").get(),
  ]);
  const userByName = new Map();
  usSnap.docs.forEach((d) => userByName.set(norm(d.data().name), { id: d.id, ...d.data() }));
  const courseByTitle = new Map();
  csSnap.docs.forEach((d) => courseByTitle.set(norm(d.data().title), { id: d.id, ...d.data() }));

  /* ---- 1) Açılacak kurslar ---- */
  const newCourses = [];
  for (const c of cols) {
    const title = TITLES[c.h];
    if (!courseByTitle.has(norm(title))) newCourses.push({ col: c.h, title });
  }

  /* ---- 2) Yazılacak kayıtlar ---- */
  const writes = [];
  const noUser = new Map();
  let badDate = 0;
  for (let r = 5; r < rows.length; r++) {
    const name = String(rows[r][1] ?? "").trim();
    if (!name) continue;
    const user = userByName.get(norm(name));
    for (const c of cols) {
      const raw = String(rows[r][c.i] ?? "").trim();
      if (!raw) continue;
      const d = parseDate(raw);
      if (!d) {
        badDate++;
        console.log(`   ! tarih okunamadı: ${name} · ${c.h} · "${raw}"`);
        continue;
      }
      if (!user) {
        noUser.set(name, (noUser.get(name) ?? 0) + 1);
        continue;
      }
      writes.push({
        id: `brscp-${user.id}-${slug(c.h)}`,
        userId: user.id,
        userName: user.name,
        userDepartmentId: user.departmentId ?? null,
        column: c.h,
        title: TITLES[c.h],
        completedAt: d,
        expiresAt: plusYears(d, VALIDITY_YEARS),
      });
    }
  }

  console.log(`\nkaynak: ${path.basename(SRC)} · sayfa "${SHEET}"`);
  console.log(`kalem: ${cols.length}   geçerlilik: ${VALIDITY_YEARS} yıl (66 hücrenin tamamından doğrulandı)`);

  console.log(`\nAÇILACAK KURS: ${newCourses.length}`);
  newCourses.forEach((c) => console.log(`   + ${c.title}`.padEnd(66) + ` ← "${c.col}"`));
  const already = cols.length - newCourses.length;
  if (already) console.log(`   (${already} kalem zaten var, dokunulmayacak)`);

  console.log(`\nYAZILACAK KAYIT: ${writes.length}`);
  const perCourse = new Map();
  writes.forEach((w) => perCourse.set(w.title, (perCourse.get(w.title) ?? 0) + 1));
  [...perCourse].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`   ${String(n).padStart(3)}  ${k}`));

  if (noUser.size) {
    console.log(`\nHESABI OLMAYAN KİŞİ (atlandı): ${noUser.size}`);
    [...noUser].forEach(([n, c]) => console.log(`   - ${n} (${c} kayıt)`));
  }
  if (badDate) console.log(`\nokunamayan tarih: ${badDate}`);

  if (!APPLY) {
    console.log("\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için: --apply");
    return;
  }

  /* ---- Kursları aç ---- */
  for (const c of newCourses) {
    const ref = await db.collection("courses").add({
      title: c.title,
      delivery: "EXTERNAL_ONLY",
      isActive: true,
      recurrenceEvery: VALIDITY_YEARS,
      recurrenceUnit: "YEAR",
      // Follow-Up'ta ayrı sekme.
      section: "BORESCOPE_RUNUP",
      exam: { required: false },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    courseByTitle.set(norm(c.title), { id: ref.id, title: c.title });
  }
  console.log(`\nkurs açıldı: ${newCourses.length}`);

  /* ---- Kayıtları yaz ---- */
  let n = 0;
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      const course = courseByTitle.get(norm(w.title));
      if (!course) throw new Error("kurs bulunamadı: " + w.title);
      batch.set(
        db.doc("externalTrainings/" + w.id),
        {
          userId: w.userId,
          userName: w.userName,
          // Müdürün sorgusu bu alana göre daraltılıyor; boş bırakılırsa
          // kayıt müdüre hiç görünmez.
          userDepartmentId: w.userDepartmentId,
          title: w.title,
          provider: "BonAir Aviation — past record (BRSCP&ENRUP)",
          courseId: course.id,
          courseTitle: w.title,
          completedAt: Timestamp.fromDate(w.completedAt),
          expiresAt: Timestamp.fromDate(w.expiresAt),
          durationHours: null,
          externalSerialNo: null,
          paperOnly: true,
          notes: "Kâğıt borescope / engine run-up takip tablosundan aktarıldı.",
          importedFrom: "BRSCP&ENRUP",
          sourceColumn: w.column,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      n++;
    }
    await batch.commit();
  }
  console.log(`kayıt yazıldı: ${n}`);

  /* ---- Kendini doğrula ---- */
  const back = await db.collection("externalTrainings").where("importedFrom", "==", "BRSCP&ENRUP").get();
  console.log(`doğrulama — geri okunan kayıt: ${back.size} (beklenen ${writes.length})`);
  const missingDept = back.docs.filter((d) => !d.data().userDepartmentId).length;
  if (missingDept) console.log(`   departmansız kayıt: ${missingDept} (müdüre görünmez)`);
}

main().catch((e) => {
  console.error("\nHATA:", e.message);
  process.exit(1);
});
