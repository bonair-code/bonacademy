/**
 * EĞİTİM YAPISINI EXCEL'DEN YENİDEN KURAR.
 *
 * Sorun: aynı eğitim dört ayrı adla duruyordu (eski kurslar, REQ_TRNG,
 * TRNG_STS, CERTIFICATE) ve "SHT-145 Training" ile "SHT-145 | Initial
 * Training" matriste iki ayrı sütun olmuştu. Bu betik hepsini tek bir
 * KONU listesine indirir — eşleme scripts/rebuild-mapping.js'de.
 *
 * SIRA ÖNEMLİ: önce yeni konular açılır, kayıtlar oraya taşınır, sonra
 * eski kurslar silinir. Tersi olsaydı sertifikalar ve elle girilen
 * belgeli kayıtlar bir an için sahipsiz kalırdı.
 *
 *   1. 24 konuyu aç (+ uçak tipi sertifikaları için eksik kalemler)
 *   2. Safety = SMS + HF eşdeğerliğini yeniden kur
 *   3. 244 sertifikayı ve elle girilen 34 kaydı yeni konulara bağla
 *   4. Kapsamların gerekli eğitim listelerini REQ_TRNG'den yaz
 *   5. Eski TRAINING kurslarını ve TRNG_STS kayıtlarını sil
 *
 * Borescope & Run-Up bölümüne DOKUNMAZ: 15 kalem ve 56 kayıt zaten
 * doğru kurulmuştu.
 *
 * Kayıtların yeniden yüklenmesi ayrı adım:
 *   node scripts/import-trng-sts.js --apply
 *
 * Kullanım:
 *   node scripts/rebuild-from-excel.js           → yalnızca rapor
 *   node scripts/rebuild-from-excel.js --apply   → uygular
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const webRequire = createRequire(path.join(__dirname, "../web/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");
const XLSX = webRequire("xlsx");
const MAP = require("./rebuild-mapping.js");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const APPLY = process.argv.includes("--apply");
const SRC =
  process.argv.find((a) => a.endsWith(".xlsx")) ||
  "C:/Users/user/BONAIR HAVACILIK SANAYI VE TICARETANONI/MAINTENANCE (PART 145) - TRAINING/01.TRAINING_FOLLOW-UP_LIST/BON-F145-094_Rev01_Training_Follow-Up_Form 2026.xlsx";

const norm = (s) => String(s ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const head = (t) => console.log("\n" + "═".repeat(70) + "\n" + t + "\n" + "─".repeat(70));

/** REQ_TRNG: kapsam bloklarını oku — her blokta INITIAL ve CONTINUATION. */
function readRequirements() {
  const wb = XLSX.readFile(SRC);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["REQ_TRNG"], { header: 1, raw: false, defval: "" });
  const out = new Map();
  let current = null;
  for (let i = 6; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c).replace(/\s+/g, " ").trim());
    if (r[1]) {
      current = r[1];
      if (!out.has(current)) out.set(current, new Set());
    }
    if (!current) continue;
    for (const name of [r[5], r[8]]) if (name) out.get(current).add(name);
  }
  return out;
}

/** REQ_TRNG'deki ad → konu adı. Bulunamazsa null. */
function subjectForReq(name) {
  const n = norm(name);
  for (const s of MAP.SUBJECTS) if (s.req.some((x) => norm(x) === n)) return s.subject;
  return null;
}
/** Eski kurs başlığı → konu adı. */
function subjectForOld(title) {
  const n = norm(title);
  for (const s of MAP.SUBJECTS) if (s.old.some((x) => norm(x) === n)) return s.subject;
  return null;
}
/**
 * Sertifikadaki eğitim adı → konu adı.
 *
 * İki ad kümesine birden bakar: Excel CERTIFICATE sayfasındaki adlar ve
 * sistemdeki eski kurs başlıkları. Canlıdaki 244 sertifika `courseTitle`
 * alanında SİSTEM başlığını taşıyor (kâğıttan aktarılırken öyle yazılmış),
 * yalnızca Excel adlarına bakmak 205 sertifikayı eşleşmez bırakıyordu.
 */
function subjectForCert(title) {
  const n = norm(title);
  for (const s of MAP.SUBJECTS)
    if (s.cert.some((x) => norm(x) === n) || s.old.some((x) => norm(x) === n)) return s.subject;
  return null;
}

async function main() {
  const [csSnap, jtSnap, exSnap, ceSnap] = await Promise.all([
    db.collection("courses").get(),
    db.collection("jobTitles").get(),
    db.collection("externalTrainings").get(),
    db.collection("certificates").get(),
  ]);

  const courses = csSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byTitle = new Map(courses.map((c) => [norm(c.title), c]));
  const training = courses.filter((c) => (c.section ?? "TRAINING") === "TRAINING");
  const borescope = courses.filter((c) => c.section === "BORESCOPE_RUNUP");

  head("1. AÇILACAK KONULAR");
  const planned = [];
  for (const s of MAP.SUBJECTS) {
    const exists = byTitle.get(norm(s.subject));
    planned.push({ ...s, existing: exists?.id ?? null });
    console.log(
      `  ${exists ? "var " : "YENİ"}  ${s.subject.padEnd(40)} ${s.years ? s.years + " yıl" : "süresiz"}`
    );
  }
  const willCreate = planned.filter((p) => !p.existing).length;
  console.log(`\n  açılacak: ${willCreate}   zaten var: ${planned.length - willCreate}`);

  head("2. UÇAK TİPİ SERTİFİKALARI (Borescope & Run-Up bölümüne)");
  const boreByTitle = new Map(borescope.map((c) => [norm(c.title), c]));
  const aircraftPlan = [];
  for (const name of MAP.AIRCRAFT_CERTS) {
    const hit = boreByTitle.get(norm(name));
    aircraftPlan.push({ name, existing: hit?.id ?? null });
  }
  const acNew = aircraftPlan.filter((a) => !a.existing);
  console.log(`  mevcut kalemle eşleşen: ${aircraftPlan.length - acNew.length}`);
  console.log(`  yeni kalem olarak açılacak: ${acNew.length}`);
  acNew.forEach((a) => console.log(`     + ${a.name}`));

  head("3. SERTİFİKALARIN YENİDEN BAĞLANMASI");
  const certPlan = [];
  const certUnmapped = new Map();
  for (const d of ceSnap.docs) {
    const v = d.data();
    const t = v.courseTitle ?? "";
    const subj = subjectForCert(t);
    const isAircraft = MAP.AIRCRAFT_CERTS.some((x) => norm(x) === norm(t));
    if (subj) certPlan.push({ id: d.id, to: subj, kind: "konu" });
    else if (isAircraft) certPlan.push({ id: d.id, to: t, kind: "uçak" });
    else certUnmapped.set(t, (certUnmapped.get(t) ?? 0) + 1);
  }
  console.log(`  bağlanacak: ${certPlan.length} / ${ceSnap.size}`);
  if (certUnmapped.size) {
    console.log(`  EŞLEŞMEYEN: ${[...certUnmapped.values()].reduce((a, b) => a + b, 0)} sertifika`);
    [...certUnmapped].forEach(([k, n]) => console.log(`     ! ${String(n).padStart(3)}  ${k}`));
  }

  head("4. ELLE GİRİLEN KAYITLARIN YENİDEN BAĞLANMASI");
  const manual = exSnap.docs.filter((d) => !d.data().importedFrom);
  const manPlan = [];
  const manUnmapped = new Map();
  for (const d of manual) {
    const t = d.data().courseTitle ?? d.data().title ?? "";
    const subj = subjectForOld(t);
    if (subj) manPlan.push({ id: d.id, to: subj });
    else manUnmapped.set(t, (manUnmapped.get(t) ?? 0) + 1);
  }
  console.log(`  bağlanacak: ${manPlan.length} / ${manual.length}`);
  if (manUnmapped.size) {
    console.log(`  EŞLEŞMEYEN:`);
    [...manUnmapped].forEach(([k, n]) => console.log(`     ! ${String(n).padStart(3)}  ${k}`));
  }

  head("5. KAPSAMLARIN GEREKLİ EĞİTİMLERİ");
  const reqs = readRequirements();
  const scopeByName = new Map(jtSnap.docs.map((d) => [norm(d.data().name), { id: d.id, ...d.data() }]));
  const scopePlan = [];
  const reqUnmapped = new Set();

  for (const [moeName, target] of Object.entries(MAP.SCOPES)) {
    const names = [...(reqs.get(moeName) ?? [])];
    const subjects = [];
    for (const n of names) {
      if (MAP.UNMAPPED_REQ.includes(n)) continue;
      const s = subjectForReq(n);
      if (s) subjects.push(s);
      else reqUnmapped.add(n);
    }
    const uniq = [...new Set(subjects)];
    if (typeof target === "string") {
      scopePlan.push({ kind: "scope", moeName, scopeName: target, subjects: uniq });
    } else if (target?.subScope) {
      scopePlan.push({ kind: "sub", moeName, scopeName: target.scope, subName: target.subScope, subjects: uniq });
    } else if (target?.create) {
      scopePlan.push({ kind: "new", moeName, scopeName: target.create, subjects: uniq });
    }
  }

  for (const p of scopePlan) {
    if (p.kind === "sub") {
      const parent = scopeByName.get(norm(p.scopeName));
      const parentPlan = scopePlan.find((x) => x.kind === "scope" && x.scopeName === p.scopeName);
      const parentSubjects = new Set(parentPlan?.subjects ?? []);
      // Alt yetki kapsamın ÜSTÜNE ekler; kapsamda zaten olan tekrarlanmaz.
      p.extra = p.subjects.filter((s) => !parentSubjects.has(s));
      console.log(
        `  ${p.scopeName} › ${p.subName} (alt yetki)  ${p.extra.length} ek eğitim` +
          (parent ? "" : "   ! kapsam bulunamadı")
      );
      p.extra.forEach((s) => console.log(`       + ${s}`));
    } else {
      const ex = scopeByName.get(norm(p.scopeName));
      console.log(
        `  ${p.scopeName}${p.kind === "new" ? "  (YENİ KAPSAM)" : ""}  ${p.subjects.length} eğitim` +
          (p.kind === "scope" && !ex ? "   ! bulunamadı" : "")
      );
      p.subjects.forEach((s) => console.log(`       - ${s}`));
    }
  }
  if (reqUnmapped.size) {
    console.log(`\n  EŞLEŞMEYEN GEREKLİLİK ADI:`);
    [...reqUnmapped].forEach((x) => console.log(`     ! ${x}`));
  }

  head("6. DOKUNULMAYAN KAPSAMLAR (gereklilikleri yeni konulara çevrilir)");
  const keepPlan = [];
  for (const name of MAP.KEEP_SCOPES) {
    const sc = scopeByName.get(norm(name));
    if (!sc) {
      console.log(`  ! ${name} bulunamadı`);
      continue;
    }
    const ids = sc.requiredCourseIds ?? [];
    const mapped = [];
    const lost = [];
    for (const id of ids) {
      const c = courses.find((x) => x.id === id);
      const subj = c ? subjectForOld(c.title) : null;
      if (subj) mapped.push(subj);
      else if (c && c.section === "BORESCOPE_RUNUP") mapped.push(c.title);
      else lost.push(c?.title ?? id);
    }
    // Alt yetkiler de çevrilmeli: "Auditor › Product" 4 kişiye
    // Aircraft Familiarization'ı zorunlu kılıyor ve kurs kimliği değişiyor.
    const subPlan = (sc.subScopes ?? []).map((sub) => {
      const conv = (ids) =>
        (ids ?? [])
          .map((id) => {
            const c = courses.find((x) => x.id === id);
            if (!c) return null;
            return subjectForOld(c.title) ?? (c.section === "BORESCOPE_RUNUP" ? c.title : null);
          })
          .filter(Boolean);
      return {
        id: sub.id,
        name: sub.name,
        required: [...new Set(conv(sub.requiredCourseIds))],
        excluded: [...new Set(conv(sub.excludedCourseIds))],
        lostReq: (sub.requiredCourseIds ?? []).length - conv(sub.requiredCourseIds).length,
      };
    });
    keepPlan.push({ id: sc.id, name, subjects: [...new Set(mapped)], lost, subPlan });
    console.log(`  ${name}: ${ids.length} eğitim → ${new Set(mapped).size} konu` + (lost.length ? `   ! ${lost.length} karşılıksız` : ""));
    lost.forEach((l) => console.log(`       ! ${l}`));
    for (const sp of subPlan) {
      if (!sp.required.length && !sp.excluded.length && !sp.lostReq) continue;
      console.log(
        `       › ${sp.name}: ${sp.required.length} gerekli, ${sp.excluded.length} düşen` +
          (sp.lostReq ? `   ! ${sp.lostReq} karşılıksız` : "")
      );
      sp.required.forEach((x) => console.log(`           + ${x}`));
    }
  }

  head("7. SİLİNECEKLER");
  const delRecs = exSnap.docs.filter((d) => d.data().importedFrom === "TRNG_STS");
  const keepTitles = new Set(MAP.SUBJECTS.map((s) => norm(s.subject)));
  const delCourses = training.filter((c) => !keepTitles.has(norm(c.title)));
  console.log(`  TRAINING bölümü kursu: ${delCourses.length} / ${training.length}`);
  delCourses.forEach((c) => console.log(`     − ${c.title}`));
  console.log(`  TRNG_STS kaydı: ${delRecs.length}`);
  console.log(`\n  DOKUNULMAYAN: Borescope ${borescope.length} kalem · BRSCP 56 kayıt · ` +
    `elle girilen ${manual.length} kayıt · ${ceSnap.size} sertifika · 68 kullanıcı · 5 departman`);

  if (!APPLY) {
    console.log("\n" + "═".repeat(70));
    console.log("KURU ÇALIŞMA — hiçbir şey yazılmadı. Uygulamak için: --apply");
    console.log("Sonra kayıtlar: node scripts/import-trng-sts.js --apply");
    return;
  }

  /* ─────────────────── UYGULAMA ─────────────────── */
  head("UYGULANIYOR");

  // 1 + 2: konuları aç
  const idOf = new Map();
  for (const p of planned) {
    if (p.existing) {
      idOf.set(p.subject, p.existing);
      await db.doc(`courses/${p.existing}`).update({
        delivery: "EXTERNAL_ONLY",
        isActive: true,
        recurrenceEvery: p.years,
        recurrenceUnit: p.years ? "YEAR" : "NONE",
        section: "TRAINING",
        updatedAt: FieldValue.serverTimestamp(),
      });
      continue;
    }
    const ref = await db.collection("courses").add({
      title: p.subject,
      delivery: "EXTERNAL_ONLY",
      isActive: true,
      recurrenceEvery: p.years,
      recurrenceUnit: p.years ? "YEAR" : "NONE",
      section: "TRAINING",
      exam: { required: false },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    idOf.set(p.subject, ref.id);
  }
  console.log(`konu: ${idOf.size}`);

  // Uçak tipi kalemleri
  for (const a of acNew) {
    const ref = await db.collection("courses").add({
      title: a.name,
      delivery: "EXTERNAL_ONLY",
      isActive: true,
      recurrenceEvery: 2,
      recurrenceUnit: "YEAR",
      section: "BORESCOPE_RUNUP",
      exam: { required: false },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    a.existing = ref.id;
  }
  const aircraftId = new Map(aircraftPlan.map((a) => [norm(a.name), a.existing]));
  console.log(`uçak tipi kalemi açıldı: ${acNew.length}`);

  // Safety = SMS + HF eşdeğerliği
  const safety = idOf.get("Safety Training (incl. Human Factors)");
  const hf = idOf.get("Human Factors");
  const sms = idOf.get("Safety Management System (SMS)");
  if (safety && hf && sms) {
    await db.doc(`courses/${safety}`).update({ satisfiedBy: { mode: "ALL", courseIds: [hf, sms] } });
    await db.doc(`courses/${hf}`).update({ satisfiedBy: { mode: "ANY", courseIds: [safety] } });
    await db.doc(`courses/${sms}`).update({ satisfiedBy: { mode: "ANY", courseIds: [safety] } });
    console.log("eşdeğerlik kuruldu: Safety = SMS + HF");
  }

  // 3: sertifikalar
  let n = 0;
  for (let i = 0; i < certPlan.length; i += 300) {
    const batch = db.batch();
    for (const c of certPlan.slice(i, i + 300)) {
      const cid = c.kind === "konu" ? idOf.get(c.to) : aircraftId.get(norm(c.to));
      if (!cid) continue;
      batch.update(db.doc(`certificates/${c.id}`), { courseId: cid });
      n++;
    }
    await batch.commit();
  }
  console.log(`sertifika yeniden bağlandı: ${n}`);

  // 4: elle girilen kayıtlar
  let m = 0;
  for (let i = 0; i < manPlan.length; i += 300) {
    const batch = db.batch();
    for (const r of manPlan.slice(i, i + 300)) {
      const cid = idOf.get(r.to);
      if (!cid) continue;
      batch.update(db.doc(`externalTrainings/${r.id}`), { courseId: cid, courseTitle: r.to });
      m++;
    }
    await batch.commit();
  }
  console.log(`elle girilen kayıt yeniden bağlandı: ${m}`);

  // 5: kapsamlar
  for (const p of scopePlan) {
    const ids = (p.kind === "sub" ? p.extra : p.subjects).map((s) => idOf.get(s)).filter(Boolean);
    if (p.kind === "new") {
      const exists = scopeByName.get(norm(p.scopeName));
      if (exists) await db.doc(`jobTitles/${exists.id}`).update({ requiredCourseIds: ids });
      else await db.collection("jobTitles").add({ name: p.scopeName, requiredCourseIds: ids, subScopes: [] });
      console.log(`kapsam ${exists ? "güncellendi" : "açıldı"}: ${p.scopeName} (${ids.length})`);
      continue;
    }
    const sc = scopeByName.get(norm(p.scopeName));
    if (!sc) continue;
    if (p.kind === "scope") {
      await db.doc(`jobTitles/${sc.id}`).update({ requiredCourseIds: ids });
      console.log(`kapsam: ${p.scopeName} (${ids.length})`);
    } else {
      const subs = (sc.subScopes ?? []).map((x) =>
        norm(x.name) === norm(p.subName) ? { ...x, requiredCourseIds: ids } : x
      );
      await db.doc(`jobTitles/${sc.id}`).update({ subScopes: subs });
      console.log(`alt yetki: ${p.scopeName} › ${p.subName} (${ids.length})`);
    }
  }

  // 6: dokunulmayan kapsamların gereklilikleri
  for (const k of keepPlan) {
    const toId = (s) => idOf.get(s) ?? aircraftId.get(norm(s));
    const ids = k.subjects.map(toId).filter(Boolean);
    const sc = scopeByName.get(norm(k.name));
    const subs = (sc?.subScopes ?? []).map((sub) => {
      const p = k.subPlan.find((x) => x.id === sub.id);
      if (!p) return sub;
      return {
        ...sub,
        requiredCourseIds: p.required.map(toId).filter(Boolean),
        excludedCourseIds: p.excluded.map(toId).filter(Boolean),
      };
    });
    await db.doc(`jobTitles/${k.id}`).update({ requiredCourseIds: ids, subScopes: subs });
    console.log(`kapsam (çevrildi): ${k.name} (${ids.length}, alt yetki ${subs.length})`);
  }

  // 7: sil
  for (let i = 0; i < delRecs.length; i += 400) {
    const batch = db.batch();
    for (const d of delRecs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  console.log(`TRNG_STS kaydı silindi: ${delRecs.length}`);
  for (let i = 0; i < delCourses.length; i += 400) {
    const batch = db.batch();
    for (const c of delCourses.slice(i, i + 400)) batch.delete(db.doc(`courses/${c.id}`));
    await batch.commit();
  }
  console.log(`eski kurs silindi: ${delCourses.length}`);

  /* Kendini doğrula */
  head("DOĞRULAMA");
  const after = await db.collection("courses").get();
  const aTr = after.docs.filter((d) => (d.data().section ?? "TRAINING") === "TRAINING").length;
  const aBr = after.docs.filter((d) => d.data().section === "BORESCOPE_RUNUP").length;
  console.log(`kurs: ${after.size}  (Training ${aTr}, Borescope ${aBr})`);
  const aEx = await db.collection("externalTrainings").get();
  const sahipsiz = aEx.docs.filter((d) => d.data().courseId && !after.docs.some((c) => c.id === d.data().courseId));
  console.log(`dış kayıt: ${aEx.size}   sahipsiz (kursu silinmiş): ${sahipsiz.length}`);
  const aCe = await db.collection("certificates").get();
  const certSahipsiz = aCe.docs.filter((d) => d.data().courseId && !after.docs.some((c) => c.id === d.data().courseId));
  console.log(`sertifika: ${aCe.size}   sahipsiz: ${certSahipsiz.length}`);
  // Hiçbir kapsam ya da alt yetki silinmiş bir kursu göstermemeli.
  const jt2 = await db.collection("jobTitles").get();
  const live = new Set(after.docs.map((d) => d.id));
  let kirik = 0;
  jt2.forEach((d) => {
    const v = d.data();
    for (const id of v.requiredCourseIds ?? []) if (!live.has(id)) kirik++;
    for (const sub of v.subScopes ?? [])
      for (const id of [...(sub.requiredCourseIds ?? []), ...(sub.excludedCourseIds ?? [])])
        if (!live.has(id)) kirik++;
  });
  console.log(`kapsamlarda silinmiş kursa işaret: ${kirik}`);

  console.log("\nSıradaki adım: node scripts/import-trng-sts.js --apply");
}

main().catch((e) => {
  console.error("\nHATA:", e.message);
  process.exit(1);
});
