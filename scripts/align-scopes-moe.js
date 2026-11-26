/**
 * Yetki kapsamlarını MOE tablosuna göre hizalar.
 *
 * Kullanıcının 10.11.2026 tarihli kararları:
 *  1. Human Factors artık ayrı takip edilmiyor; her yerde "Safety Training
 *     (incl. Human Factors)" geçerli. Human Factors KURSU silinmiyor —
 *     11 kaydı var ve Safety = ALL[HF, SMS] eşdeğerliği ona dayanıyor;
 *     yalnızca hiçbir kapsamda zorunlu tutulmuyor.
 *  2. ATA Spec 300 / Hidden Damage / ESD / DGR eklenmiyor: hepsi Incoming
 *     Inspection eğitiminin içinde veriliyor.
 *  3. Fuel Tank Safety tek konu kalıyor; seviye ayrımını eğitim düzenlenirken
 *     eğitim birimi yapıyor.
 *  4. Müdürler kendi departmanlarının personeli gibi değerlendiriliyor:
 *     kapsam departmana ait, müdür de o kapsamda.
 *  5. "Technical Quality & Safety Engineer" kapsamı Auditor'ün aynısı;
 *     kimse bağlı olmadığı için kaldırılıyor. Silinmiş bir kursa işaret eden
 *     tek gereklilik de böylece temizleniyor.
 *
 * Kullanım:
 *   node scripts/align-scopes-moe.js           → rapor
 *   node scripts/align-scopes-moe.js --apply   → uygular
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
const head = (t) => console.log("\n" + "═".repeat(66) + "\n" + t + "\n" + "─".repeat(66));

/** Kapsam → MOE'ye göre olması gereken tam gerekli eğitim listesi. */
const WANT = {
  "Certifying Staff": [
    "SHT-145",
    "SHT-CAM / Part-M",
    "SHT-66",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Technology Update",
    "Safety Training (incl. Human Factors)",
  ],
  Technician: [
    "SHT-145",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  "Mechanic Technician": [
    "SHT-145",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  Auditor: [
    "Quality Systems",
    "Audit Techniques",
    "Company Procedures (MOE)",
    "SHT-145",
    "SHT-66",
    "SHT-CAM / Part-M",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  // MOE bu rol için ayrı bir dokümana yönlendiriyor; mevcut liste korunuyor.
  "NDT Staff": null,
  "Supply Manager": [
    "SHT-145",
    "Company Procedures (MOE)",
    "Safety Training (incl. Human Factors)",
  ],
  "Engineering and Planning Manager": [
    "SHT-145",
    "SHT-CAM / Part-M",
    "SHT-66",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  Instructor: [
    "SHT-145",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Train The Trainer",
    "Safety Training (incl. Human Factors)",
  ],
};

/**
 * MOE tablosunda olup sistemde karşılığı olmayan roller. Kişi ataması
 * kullanıcıda; kapsam boş açılıyor.
 *
 * Not: "Technician" MOE'deki Non-CS, "Mechanic Technician" ise Mechanics
 * satırına karşılık geliyor. İkisinin gerekli eğitimi aynı ama ayrı
 * kapsam olarak kalıyorlar (kullanıcı kararı).
 */
const CREATE = {
  "Accountable Manager": ["SHT-145", "Safety Training (incl. Human Factors)"],
  "Base & Line Maintenance Manager": [
    "SHT-145",
    "SHT-CAM / Part-M",
    "SHT-66",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  // MOE Level 1 istiyor; Fuel Tank Safety tek konu olarak takip ediliyor,
  // seviye ayrımını eğitim birimi eğitimi düzenlerken yapıyor.
  Cleaner: [
    "SHT-145",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Safety Training (incl. Human Factors)",
  ],
  Inspector: [
    "SHT-145",
    "SHT-CAM / Part-M",
    "SHT-66",
    "Company Procedures (MOE)",
    "Fuel Tank Safety",
    "EWIS",
    "Technology Update",
    "Safety Training (incl. Human Factors)",
  ],
};

/** Kapsam adı departmanı anlatsın: 5 kişilik listeye "Manager" demek yanıltıcı. */
const RENAME = {
  "Supply Manager": "Supply Department",
  "Engineering and Planning Manager": "Engineering & Planning Department",
};

/** Auditor ile aynı olduğu için kaldırılan kapsam. */
const DROP = "Technical Quality & Safety Engineer";

/** Departmanı olup kapsamı olmayan personele verilecek kapsam. */
const DEPT_SCOPE = {
  "Supply Department": "Supply Manager",
  "Planning Department": "Engineering and Planning Manager",
  "Engineering Department": "Engineering and Planning Manager",
};

async function main() {
  const [jtSnap, csSnap, usSnap, dpSnap] = await Promise.all([
    db.collection("jobTitles").get(),
    db.collection("courses").get(),
    db.collection("users").get(),
    db.collection("departments").get(),
  ]);
  const courseByTitle = new Map(csSnap.docs.map((d) => [norm(d.data().title), d.id]));
  const titleById = new Map(csSnap.docs.map((d) => [d.id, d.data().title]));
  const scopeByName = new Map(jtSnap.docs.map((d) => [norm(d.data().name), { id: d.id, ...d.data() }]));
  const deptName = new Map(dpSnap.docs.map((d) => [d.id, d.data().name]));

  head("1. GEREKLİ EĞİTİM LİSTELERİ");
  const updates = [];
  for (const [scopeName, want] of Object.entries(WANT)) {
    const sc = scopeByName.get(norm(scopeName));
    if (!sc) {
      console.log(`  ! kapsam yok: ${scopeName}`);
      continue;
    }
    if (want === null) {
      console.log(`  = ${scopeName}: dokunulmuyor`);
      continue;
    }
    const ids = [];
    const eksikKurs = [];
    for (const t of want) {
      const id = courseByTitle.get(norm(t));
      if (id) ids.push(id);
      else eksikKurs.push(t);
    }
    if (eksikKurs.length) throw new Error(`${scopeName}: sistemde olmayan eğitim → ${eksikKurs.join(", ")}`);

    const now = new Set(sc.requiredCourseIds ?? []);
    const next = new Set(ids);
    const eklenen = ids.filter((x) => !now.has(x)).map((x) => titleById.get(x));
    const cikan = [...now].filter((x) => !next.has(x)).map((x) => titleById.get(x) ?? "(silinmiş kurs)");
    if (!eklenen.length && !cikan.length) {
      console.log(`  = ${scopeName}: değişiklik yok (${ids.length})`);
      continue;
    }
    console.log(`  ~ ${scopeName}: ${now.size} → ${ids.length}`);
    eklenen.forEach((x) => console.log(`       + ${x}`));
    cikan.forEach((x) => console.log(`       − ${x}`));
    updates.push({ id: sc.id, name: scopeName, ids });
  }

  head("2. ADI DEĞİŞENLER");
  const renames = [];
  for (const [from, to] of Object.entries(RENAME)) {
    const sc = scopeByName.get(norm(from));
    if (!sc) continue;
    renames.push({ id: sc.id, from, to });
    console.log(`  ${from}  →  ${to}`);
  }

  head("3. KALDIRILAN KAPSAM");
  const drop = scopeByName.get(norm(DROP));
  let dropCount = 0;
  if (drop) {
    dropCount = usSnap.docs.filter((d) => (d.data().jobTitleIds ?? []).includes(drop.id)).length;
    const dangling = (drop.requiredCourseIds ?? []).filter((x) => !titleById.has(x)).length;
    console.log(`  ${DROP}  —  ${dropCount} kişi bağlı, ${dangling} silinmiş kursa işaret`);
    if (dropCount > 0) throw new Error("Kapsama bağlı kişi var; silmiyorum.");
  } else console.log("  (bulunamadı)");

  head("3b. AÇILACAK KAPSAMLAR");
  const creates = [];
  for (const [name, want] of Object.entries(CREATE)) {
    if (scopeByName.get(norm(name))) {
      console.log(`  = ${name}: zaten var, dokunulmuyor`);
      continue;
    }
    const ids = [];
    const eksik = [];
    for (const t of want) {
      const id = courseByTitle.get(norm(t));
      if (id) ids.push(id);
      else eksik.push(t);
    }
    if (eksik.length) throw new Error(`${name}: sistemde olmayan eğitim → ${eksik.join(", ")}`);
    creates.push({ name, ids });
    console.log(`  + ${name} (${ids.length} eğitim)`);
    want.forEach((t) => console.log(`       - ${t}`));
  }

  head("4. KAPSAMSIZ PERSONELE KAPSAM");
  const assigns = [];
  for (const d of usSnap.docs) {
    const v = d.data();
    if (v.isActive === false || v.role === "CUSTOMER") continue;
    if ((v.jobTitleIds ?? []).length > 0) continue;
    const dep = deptName.get(v.departmentId);
    const scopeName = dep ? DEPT_SCOPE[dep] : null;
    const sc = scopeName ? scopeByName.get(norm(scopeName)) : null;
    if (!sc) {
      console.log(`  ! ${v.name} — departman "${dep ?? "yok"}" için kapsam tanımlı değil`);
      continue;
    }
    assigns.push({ id: d.id, name: v.name, scopeId: sc.id, scopeName: RENAME[scopeName] ?? scopeName });
  }
  const byScope = new Map();
  assigns.forEach((a) => byScope.set(a.scopeName, [...(byScope.get(a.scopeName) ?? []), a.name]));
  [...byScope].forEach(([s, list]) => {
    console.log(`  ${s} (${list.length})`);
    list.forEach((n) => console.log(`     + ${n}`));
  });

  if (!APPLY) {
    console.log("\n" + "═".repeat(66));
    console.log("KURU ÇALIŞMA — hiçbir şey yazılmadı. Uygulamak için: --apply");
    return;
  }

  head("UYGULANIYOR");
  for (const u of updates) {
    await db.doc(`jobTitles/${u.id}`).update({ requiredCourseIds: u.ids });
    console.log(`gereklilik: ${u.name} (${u.ids.length})`);
  }
  for (const r of renames) {
    await db.doc(`jobTitles/${r.id}`).update({ name: r.to });
    console.log(`ad: ${r.from} → ${r.to}`);
  }
  if (drop && dropCount === 0) {
    await db.doc(`jobTitles/${drop.id}`).delete();
    console.log(`kaldırıldı: ${DROP}`);
  }
  for (const c of creates) {
    await db.collection("jobTitles").add({ name: c.name, requiredCourseIds: c.ids, subScopes: [] });
    console.log(`kapsam açıldı: ${c.name} (${c.ids.length})`);
  }
  for (let i = 0; i < assigns.length; i += 300) {
    const batch = db.batch();
    for (const a of assigns.slice(i, i + 300))
      batch.update(db.doc(`users/${a.id}`), { jobTitleIds: FieldValue.arrayUnion(a.scopeId) });
    await batch.commit();
  }
  console.log(`kapsam atandı: ${assigns.length} kişi`);

  head("DOĞRULAMA");
  const [jt2, us2, cs2] = await Promise.all([
    db.collection("jobTitles").get(),
    db.collection("users").get(),
    db.collection("courses").get(),
  ]);
  const live = new Set(cs2.docs.map((d) => d.id));
  let kirik = 0;
  jt2.forEach((d) => {
    for (const id of d.data().requiredCourseIds ?? []) if (!live.has(id)) kirik++;
    for (const s of d.data().subScopes ?? [])
      for (const id of [...(s.requiredCourseIds ?? []), ...(s.excludedCourseIds ?? [])])
        if (!live.has(id)) kirik++;
  });
  const kapsamsiz = us2.docs.filter(
    (d) =>
      d.data().isActive !== false &&
      d.data().role !== "CUSTOMER" &&
      (d.data().jobTitleIds ?? []).length === 0
  ).length;
  console.log(`kapsam: ${jt2.size}  ·  silinmiş kursa işaret: ${kirik}  ·  kapsamsız personel: ${kapsamsiz}`);
  jt2.docs
    .map((d) => `   ${d.data().name}: ${(d.data().requiredCourseIds ?? []).length} eğitim`)
    .sort()
    .forEach((x) => console.log(x));
}

main().catch((e) => {
  console.error("\nHATA:", e.message);
  process.exit(1);
});
