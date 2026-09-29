/**
 * TRNG_STS aktarımının ön koşulları: matriste olup sistemde olmayan
 * eğitim(ler) ve kullanıcılar. Çalıştırdıktan sonra import-trng-sts.js
 * tekrar çalıştırılır (idempotent).
 *
 * Kullanım:
 *   node scripts/seed-from-trng-sts.js            → dry run
 *   node scripts/seed-from-trng-sts.js --apply    → oluşturur
 */
const path = require("path");
const { createRequire } = require("module");
const { randomBytes } = require("crypto");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, FieldValue } = fnRequire("firebase-admin/firestore");
const { getAuth } = fnRequire("firebase-admin/auth");

const APPLY = process.argv.includes("--apply");

/**
 * Matriste kolonu olup sistemde kursu olmayan, açılması istenen eğitimler.
 * Diğerleri (ESD, DGR, ATA 300, Hidden Damage, Tool Calibration…) Incoming
 * Inspection eğitiminin içinde veriliyor; Module-10 artık ayrılmış — kurs
 * olarak açılmıyorlar.
 */
const TRACKED_TRAININGS = [{ title: "English Exam", recurrenceEvery: 5, recurrenceUnit: "YEAR" }];

const DEPT = {
  QUALITY: "BposuLzQ7tpyYXtsMDEF", // Technical Quality & Safety
  MAINTENANCE: "H22lRIknfWeUwZIg4l2l",
  SUPPLY: "0Id1J1DQWBT3bFdTccnY",
};
const SCOPE = {
  CERTIFYING_STAFF: "DeC5HU8dxOJR1fTBR9l3",
  TECHNICIAN: "KXGjiqnNv8d2WaDW215J",
  MECHANIC_TECHNICIAN: "M9CGqZzEwol7GfKt5BIX",
  AUDITOR: "dX8wAGhSEVXFM7Rw44gn",
};

/**
 * Matriste olup sistemde hesabı olmayan personel. E-postalar mevcut
 * kalıptan (ad baş harfi + soyad) türetildi, kullanıcı onayladı.
 * Kapsamlar aynı görevdeki mevcut personelden alındı — Users ekranından
 * düzeltilebilir.
 */
const USERS = [
  {
    name: "Onur ÜÇKALELER",
    email: "ouckaleler@bonair.com.tr",
    departmentId: DEPT.QUALITY,
    jobTitleIds: [SCOPE.AUDITOR],
  },
  {
    // Kullanıcı düzeltti: NDT değil, Certifying Staff.
    name: "Hüseyin KILCIOĞLU",
    email: "hkilcioglu@bonair.com.tr",
    departmentId: DEPT.MAINTENANCE,
    jobTitleIds: [SCOPE.CERTIFYING_STAFF, SCOPE.MECHANIC_TECHNICIAN, SCOPE.TECHNICIAN],
  },
  {
    // Accountable Manager — eşleşen bir yetki kapsamı yok, boş bırakıldı.
    name: "Tolga GÜL",
    email: "tgul@bonair.com.tr",
    departmentId: null,
    jobTitleIds: [],
  },
  {
    name: "Eylül PIRTIL",
    email: "epirtil@bonair.com.tr",
    departmentId: DEPT.SUPPLY,
    jobTitleIds: [],
  },
  {
    name: "Ercan YAZAR",
    email: "eyazar@bonair.com.tr",
    departmentId: DEPT.MAINTENANCE,
    jobTitleIds: [SCOPE.MECHANIC_TECHNICIAN, SCOPE.TECHNICIAN],
  },
];

const norm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();
  const auth = getAuth();

  const courses = (await db.collection("courses").get()).docs.map((d) => ({
    id: d.id,
    title: d.data().title,
  }));
  const haveCourse = new Set(courses.map((c) => norm(c.title)));

  for (const t of TRACKED_TRAININGS) {
    if (haveCourse.has(norm(t.title))) {
      console.log("kurs zaten var:", t.title);
      continue;
    }
    console.log(
      (APPLY ? "oluşturuluyor" : "[dry] oluşturulacak") +
        " kurs: " +
        t.title +
        " · " +
        t.recurrenceEvery +
        " " +
        t.recurrenceUnit
    );
    if (!APPLY) continue;
    const ref = await db.collection("courses").add({
      title: t.title,
      recurrenceEvery: t.recurrenceEvery,
      recurrenceUnit: t.recurrenceUnit,
      delivery: "EXTERNAL_ONLY",
      isActive: true,
      exam: { required: false },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log("   id:", ref.id);
  }

  const existingEmails = new Set(
    (await db.collection("users").get()).docs.map((d) => String(d.data().email || "").toLowerCase())
  );

  for (const u of USERS) {
    if (existingEmails.has(u.email)) {
      console.log("kullanıcı zaten var:", u.email);
      continue;
    }
    console.log(
      (APPLY ? "oluşturuluyor" : "[dry] oluşturulacak") +
        " kullanıcı: " +
        u.name +
        " · " +
        u.email +
        " · scope:" +
        (u.jobTitleIds.length || "yok")
    );
    if (!APPLY) continue;
    // Geçici şifre burada üretilir ve hiçbir yere yazdırılmaz; admin Users
    // ekranından "Set password" ile kendi şifresini verir.
    const password = randomBytes(12).toString("base64") + "Aa1!";
    const rec = await auth.createUser({ email: u.email, password, displayName: u.name });
    await auth.setCustomUserClaims(rec.uid, { role: "USER", departmentId: u.departmentId });
    await db.doc("users/" + rec.uid).set({
      email: u.email,
      name: u.name,
      role: "USER",
      departmentId: u.departmentId,
      jobTitleIds: u.jobTitleIds,
      subScopeIds: [],
      birthPlace: null,
      birthDate: null,
      mustChangePassword: true,
      isActive: true,
      locale: "tr",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log("   uid:", rec.uid);
  }

  if (!APPLY) console.log("\n[dry run] Hiçbir şey oluşturulmadı. Yazmak için: --apply");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
