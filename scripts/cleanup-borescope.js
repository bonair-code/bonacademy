/**
 * BORESCOPE & ENGINE RUN-UP bölümünü toparlar.
 *
 * Üç iş:
 *
 * 1. MÜKERRERLERİ BİRLEŞTİR. Sertifikalardan açılan kalemler, kâğıt
 *    takip tablosundan gelen kalemlerin aynısıydı — aynı eğitim iki
 *    sütunda duruyordu: birinde kayıtlar, diğerinde sertifikalar.
 *    Sertifikalar kayıtlı kaleme taşınır, boş kopya silinir.
 *
 * 2. ADLARI STANDARDA ÇEVİR. İş türü başa geçer:
 *    "Borescope — RR BR710", "Engine Run-Up — Challenger 604/605".
 *    Alfabetik sıralandığında bütün borescope kalemleri yan yana,
 *    bütün run-up kalemleri yan yana gelir.
 *
 * 3. DIŞARIYA VERİLEN EĞİTİMLERİ MATRİSTEN ÇIKAR. PRE&POST FLIGHT
 *    eğitimleri BonAir'in dışarıya verdiği eğitimler; sertifikaları 13
 *    dış kişiye ait, personel takibinde işleri yok. `section: EXTERNAL`
 *    olurlar: Follow-Up'ın iki sekmesinde de görünmezler ama Sertifika
 *    Defteri'nde kalırlar — seri numarası tüketmiş bir sertifika
 *    defterden silinmemeli.
 *
 * Ayrıca "Tap Test" iki kopya olmuş ve biri silinmiş; 7 kayıt sahipsiz
 * kalmış. Kalan kaleme bağlanır.
 *
 * Kullanım:
 *   node scripts/cleanup-borescope.js           → rapor
 *   node scripts/cleanup-borescope.js --apply   → uygular
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();
const APPLY = process.argv.includes("--apply");
const norm = (s) => String(s ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const head = (t) => console.log("\n" + "═".repeat(68) + "\n" + t + "\n" + "─".repeat(68));

/** Sertifikadan açılmış boş kopya → kayıtları taşıyan asıl kalem. */
const MERGE = {
  "Gulfstream GV-SP Series - RRD BR710 Engine RunUp Training": "RR BR710 ER Gulfstream GV — Engine Run-Up",
  "Bombardier BD700 (RRD BR710) - Engine RunUp Training": "Global XRS BD-700 — Engine Run-Up",
  "GLOBAL_ENGINE RUN-UP_TRAINING": "Global XRS BD-700 — Engine Run-Up",
  "HAWKER Bae125 Series (Honeywell TFE731)  - Engine RunUp Training":
    "Hawker BAe 125 750/800XP/850XP/900XP (TFE731) — Engine Run-Up",
  "Gulfstream GIV-SP Series (RRD Tay) - Engine RunUp Training": "Gulfstream G4 — Engine Run-Up",
  "Embraer EMB 135-145 (RR Corp AE3007A) - Engine RunUp Training":
    "Embraer EMB-135/145 (RR Corp AE3007A) — Engine Run-Up",
};

/** Eski ad → standart ad. İş türü başta; motor borescope'ta, uçak run-up'ta. */
const RENAME = {
  "RR BR710 — Borescope": "Borescope — RR BR710",
  "RR Tay 611 — Borescope": "Borescope — RR Tay 611",
  "RR Corp AE3007A — Borescope": "Borescope — RR Corp AE3007A",
  "Honeywell AS907 — Borescope": "Borescope — Honeywell AS907",
  "Honeywell TFE731 — Borescope": "Borescope — Honeywell TFE731",
  "GE CF34-3 — Borescope": "Borescope — GE CF34-3",
  "Challenger 300 — Engine Run-Up": "Engine Run-Up — Challenger 300",
  "Challenger 604/605 — Engine Run-Up": "Engine Run-Up — Challenger 604/605",
  "Challenger 850 CL600-2B19 — Engine Run-Up": "Engine Run-Up — Challenger 850 (CL600-2B19)",
  "Global XRS BD-700 — Engine Run-Up": "Engine Run-Up — Global XRS (BD-700)",
  "RR BR710 ER Gulfstream GV — Engine Run-Up": "Engine Run-Up — Gulfstream GV (RR BR710)",
  "Gulfstream G4 — Engine Run-Up": "Engine Run-Up — Gulfstream G4 (RR Tay)",
  "Hawker BAe 125 750/800XP/850XP/900XP (TFE731) — Engine Run-Up":
    "Engine Run-Up — Hawker BAe 125 750/800XP/850XP/900XP (TFE731)",
  "Embraer EMB-135/145 (RR Corp AE3007A) — Engine Run-Up":
    "Engine Run-Up — Embraer EMB-135/145 (RR Corp AE3007A)",
  "Tap Test": "Tap Test",
};

/** Dışarıya verilen eğitimler — matristen çıkar, sertifika defterinde kalır. */
const isExternal = (t) => /PRE.?.?POST\s*FLIGHT|PRE-FLIGHT/i.test(t);

async function main() {
  const [csSnap, exSnap, ceSnap] = await Promise.all([
    db.collection("courses").get(),
    db.collection("externalTrainings").get(),
    db.collection("certificates").get(),
  ]);
  const courses = csSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const live = new Set(courses.map((c) => c.id));
  const bore = courses.filter((c) => c.section === "BORESCOPE_RUNUP");
  const byTitle = new Map();
  for (const c of bore) byTitle.set(norm(c.title), c);
  // Sahipsiz kayıt aranırken BÜTÜN kurslara bakılır: kuru çalışma bir
  // "Module 10" kaydının da sahipsiz kaldığını gösterdi, o kurs Training
  // bölümünde. Yalnızca Borescope bölümüne bakmak onu bulamıyordu.
  const anyTitle = new Map();
  for (const c of courses) if (!anyTitle.has(norm(c.title))) anyTitle.set(norm(c.title), c);

  const recCount = new Map();
  exSnap.forEach((d) => {
    const c = d.data().courseId;
    if (c) recCount.set(c, (recCount.get(c) ?? 0) + 1);
  });
  const certCount = new Map();
  ceSnap.forEach((d) => {
    const c = d.data().courseId;
    if (c) certCount.set(c, (certCount.get(c) ?? 0) + 1);
  });

  head("1. SAHİPSİZ KAYITLAR");
  const orphan = exSnap.docs.filter((d) => d.data().courseId && !live.has(d.data().courseId));
  const orphanBy = new Map();
  orphan.forEach((d) => {
    const t = d.data().courseTitle ?? "?";
    orphanBy.set(t, (orphanBy.get(t) ?? 0) + 1);
  });
  console.log(`  sahipsiz dış kayıt: ${orphan.length}`);
  [...orphanBy].forEach(([t, n]) => {
    const hedef = anyTitle.get(norm(t));
    console.log(`     ${String(n).padStart(3)}  ${t}  →  ${hedef ? hedef.title : "! HEDEF YOK"}`);
  });

  head("2. BİRLEŞTİRİLECEK MÜKERRERLER");
  const merges = [];
  for (const [from, to] of Object.entries(MERGE)) {
    const a = byTitle.get(norm(from));
    const b = byTitle.get(norm(to));
    if (!a) {
      console.log(`     (yok, atlandı) ${from}`);
      continue;
    }
    if (!b) {
      console.log(`     ! HEDEF YOK: ${to}`);
      continue;
    }
    merges.push({ a, b });
    console.log(
      `     ${from}\n        ${certCount.get(a.id) ?? 0} sertifika → "${b.title}" (${recCount.get(b.id) ?? 0} kayıt)`
    );
  }

  head("3. YENİDEN ADLANDIRMA");
  const renames = [];
  for (const c of bore) {
    if (merges.some((m) => m.a.id === c.id)) continue; // silinecek
    if (isExternal(c.title)) continue;
    const yeni = RENAME[c.title];
    if (!yeni) {
      console.log(`     ! standart ad tanımlı değil: ${c.title}`);
      continue;
    }
    if (yeni === c.title) continue;
    renames.push({ id: c.id, from: c.title, to: yeni });
  }
  renames
    .sort((x, y) => x.to.localeCompare(y.to, "tr"))
    .forEach((r) => console.log(`     ${r.from}\n        →  ${r.to}`));
  console.log(`  toplam: ${renames.length}`);

  head("4. MATRİSTEN ÇIKARILACAK (dışarıya verilen eğitimler)");
  const external = bore.filter((c) => isExternal(c.title));
  external.forEach((c) =>
    console.log(`     ${c.title}   (${certCount.get(c.id) ?? 0} sertifika, ${recCount.get(c.id) ?? 0} kayıt)`)
  );
  console.log(`  toplam: ${external.length} kalem → section: EXTERNAL (sertifikalar defterde kalır)`);

  const kalan = bore.length - merges.length - external.length;
  console.log(`\n  SONUÇ: Borescope & Run-Up sekmesinde ${bore.length} yerine ${kalan} kalem kalır.`);

  if (!APPLY) {
    console.log("\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Uygulamak için: --apply");
    return;
  }

  head("UYGULANIYOR");

  // 1: sahipsiz kayıtları bağla
  let o = 0;
  for (const d of orphan) {
    const hedef = anyTitle.get(norm(d.data().courseTitle ?? ""));
    if (!hedef) continue;
    await d.ref.update({ courseId: hedef.id });
    o++;
  }
  console.log(`sahipsiz kayıt bağlandı: ${o}/${orphan.length}`);

  // 2: birleştir — sertifikaları taşı, kopyayı sil
  let moved = 0;
  for (const m of merges) {
    const certs = ceSnap.docs.filter((d) => d.data().courseId === m.a.id);
    for (let i = 0; i < certs.length; i += 300) {
      const batch = db.batch();
      for (const c of certs.slice(i, i + 300)) {
        batch.update(c.ref, { courseId: m.b.id });
        moved++;
      }
      await batch.commit();
    }
    const recs = exSnap.docs.filter((d) => d.data().courseId === m.a.id);
    for (const rdoc of recs) await rdoc.ref.update({ courseId: m.b.id, courseTitle: m.b.title });
    await db.doc(`courses/${m.a.id}`).delete();
  }
  console.log(`birleştirildi: ${merges.length} kalem, ${moved} sertifika taşındı`);

  // 3: yeniden adlandır (kayıt ve sertifikalardaki kopya başlık da)
  for (const r of renames) {
    await db.doc(`courses/${r.id}`).update({ title: r.to, updatedAt: FieldValue.serverTimestamp() });
    const recs = exSnap.docs.filter((d) => d.data().courseId === r.id);
    for (const rdoc of recs) await rdoc.ref.update({ courseTitle: r.to, title: r.to });
  }
  console.log(`yeniden adlandırıldı: ${renames.length}`);

  // 4: dışarıya verilenleri matristen çıkar
  for (const c of external) {
    await db.doc(`courses/${c.id}`).update({ section: "EXTERNAL", updatedAt: FieldValue.serverTimestamp() });
  }
  console.log(`matristen çıkarıldı: ${external.length}`);

  head("DOĞRULAMA");
  const after = await db.collection("courses").get();
  const liveAfter = new Set(after.docs.map((d) => d.id));
  const ex2 = await db.collection("externalTrainings").get();
  const ce2 = await db.collection("certificates").get();
  const sahipsizEx = ex2.docs.filter((d) => d.data().courseId && !liveAfter.has(d.data().courseId)).length;
  const sahipsizCe = ce2.docs.filter((d) => d.data().courseId && !liveAfter.has(d.data().courseId)).length;
  const b2 = after.docs.filter((d) => d.data().section === "BORESCOPE_RUNUP");
  const e2 = after.docs.filter((d) => d.data().section === "EXTERNAL");
  console.log(`kurs: ${after.size}  (Borescope ${b2.length}, External ${e2.length})`);
  console.log(`sahipsiz: dış kayıt ${sahipsizEx} · sertifika ${sahipsizCe}`);
  console.log("\nBorescope & Run-Up kalemleri:");
  b2.map((d) => d.data().title)
    .sort((a, b) => a.localeCompare(b, "tr"))
    .forEach((t) => console.log("   ", t));
}

main().catch((e) => {
  console.error("\nHATA:", e.message);
  process.exit(1);
});
