/**
 * TRNG_STS matrisini (kâğıt eğitim takip tablosu) sisteme aktarır.
 *
 * Tablonun okunuşu — kalan-gün satırından doğrulandı:
 *   hücredeki tarih  = eğitimin ALINDIĞI tarih
 *   altındaki satır  = bugüne göre kalan gün → geçerlilik süresi buradan geri hesaplanır
 *
 * Kayıtlar `externalTrainings` koleksiyonuna yazılır; doc id kişi+kolon'dan
 * türetildiği için script tekrar çalıştırılınca kopya oluşmaz, günceller.
 *
 * Kullanım:
 *   node scripts/import-trng-sts.js            → dry run, hiçbir şey yazmaz
 *   node scripts/import-trng-sts.js --apply    → yazar
 */
const path = require("path");
const { createRequire } = require("module");
// Bağımlılıklar web/ ve functions/ altında; oradan çözülsün.
const webRequire = createRequire(path.join(__dirname, "../web/package.json"));
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const XLSX = webRequire("xlsx");
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = fnRequire("firebase-admin/firestore");

const FILE = process.env.TRNG_FILE || "C:/Users/user/Desktop/Follow Up Training.xlsx";
const APPLY = process.argv.includes("--apply");

/** Tablo bir kez okunur; hem TODAY hem parseSheet aynı satırları kullanır. */
const SHEET_ROWS = XLSX.utils.sheet_to_json(XLSX.readFile(FILE).Sheets["TRNG_STS"], {
  header: 1,
  raw: true,
  defval: "",
});

/**
 * Kalan-gün sütunu tablonun KENDİ "LAST MOD. DATE" hücresine göre hesaplanmış.
 * Burada sabit tarih tutmak, dosya güncellendiğinde geçerlilik sürelerinin
 * yanlış çıkmasına yol açıyordu (eşleşme toleransı yalnızca ±2 gün).
 */
const TODAY = (() => {
  const v = SHEET_ROWS[2] && SHEET_ROWS[2][10];
  if (typeof v !== "number")
    throw new Error("LAST MOD. DATE okunamadı (TRNG_STS, 3. satir K sutunu).");
  return new Date(Math.round((v - 25569) * 86400000));
})();

/**
 * Matris kolonu → sistemdeki kurs başlığı.
 *
 * Elle yazılmıyor: tek kaynak scripts/rebuild-mapping.js. Orada her konu
 * hangi TRNG_STS sütunundan beslendiğini söylüyor; burada ters çevriliyor.
 * Eskiden bu liste elle tutuluyordu ve kurs adı değiştiğinde sessizce
 * kopuyordu.
 *
 * Burada olmayan kolon aktarılmaz (eğitim olmayan sütunlar: COMPETENCE
 * ASSESSMENT, OJT …, LICENCE EXPIRE DATE — bkz. SKIP_TRNG).
 */
const COURSE_BY_COLUMN = Object.fromEntries(
  require("./rebuild-mapping.js")
    .SUBJECTS.filter((s) => s.trng)
    .map((s) => [s.trng, s.subject])
);

const DEPTS = [
  "QUALITY DEPARTMENT",
  "CERTIFYING STAFF",
  "MANAGEMENT",
  "SUPPLY DEPARTMENT",
  "ENGINEERING and PLANNING",
  "STORE & TOOLSTORE",
  "MECHANIC",
];

const norm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
const serialToDate = (v) => new Date(Math.round((v - 25569) * 86400000));
const iso = (d) => d.toISOString().slice(0, 10);
const plusYears = (d, y) =>
  new Date(Date.UTC(d.getUTCFullYear() + y, d.getUTCMonth(), d.getUTCDate()));
const daysBetween = (a, b) => Math.round((a - b) / 86400000);
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Hücreyi yorumlar. Kalan gün varsa geçerlilik süresini ondan türetir;
 * yoksa eğitim tek seferlik (süresiz) sayılır.
 */
function readCell(dateSerial, remaining) {
  const completed = serialToDate(dateSerial);
  if (typeof remaining !== "number") return { completed, validityYears: null };
  for (const y of [1, 2, 3, 4, 5, 6, 10]) {
    if (Math.abs(daysBetween(plusYears(completed, y), TODAY) - remaining) <= 2)
      return { completed, validityYears: y };
  }
  // Tarihin kendisi bitiş tarihi gibi girilmişse: bugün + kalan gün = hücre.
  if (Math.abs(daysBetween(completed, TODAY) - remaining) <= 2)
    return { completed, validityYears: null, looksLikeExpiry: true };
  return { completed, validityYears: null, unexplained: remaining };
}

function parseSheet() {
  const rows = SHEET_ROWS;
  const header = rows[4].map((h) => String(h).replace(/\s+/g, " ").trim());
  const people = [];
  let dept = "";
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i];
    const c0 = String(row[0] || "").trim();
    if (DEPTS.includes(c0)) dept = c0;
    const name = String(row[1] || "").trim();
    if (!name) continue;
    const rem = rows[i + 1] || [];
    const cells = {};
    for (let c = 3; c <= 33; c++) {
      const col = header[c];
      if (!col) continue;
      const v = row[c];
      if (v === "" || v == null) continue;
      cells[col] = typeof v === "number" ? readCell(v, rem[c]) : { note: String(v).trim() };
    }
    people.push({ name, duty: String(row[2] || "").trim(), dept, cells });
  }
  return people;
}

async function main() {
  initializeApp({ projectId: "bonair-academy" });
  const db = getFirestore();

  const users = (await db.collection("users").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const userByName = new Map(users.map((u) => [norm(u.displayName || u.name), u]));

  const courses = (await db.collection("courses").get()).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
  const courseByTitle = new Map(courses.map((c) => [norm(c.title), c]));

  const people = parseSheet();

  /** Kolon başına en sık görülen geçerlilik süresi — bozuk hücreler için yedek. */
  const dominantValidity = {};
  {
    const tally = {};
    for (const p of people)
      for (const [col, cell] of Object.entries(p.cells))
        if (cell.validityYears) {
          tally[col] = tally[col] || {};
          tally[col][cell.validityYears] = (tally[col][cell.validityYears] || 0) + 1;
        }
    for (const [col, t] of Object.entries(tally))
      dominantValidity[col] = Number(Object.entries(t).sort((a, b) => b[1] - a[1])[0][0]);
  }

  const writes = [];
  const skipped = { noUser: [], noCourse: [], planned: [], note: [], expiryStyle: [], odd: [] };

  for (const p of people) {
    const user = userByName.get(norm(p.name));
    if (!user) {
      skipped.noUser.push(p.name);
      continue;
    }

    /**
     * Kapsama BURADA TÜRETİLMEZ.
     *
     * "Safety Training = SMS + HF" kuralı artık kursun kendi ayarında
     * (`satisfiedBy`) duruyor ve ekranlar bunu okuma anında çözüyor
     * (lib/records.ts → resolveCoverage). Import'un kâğıttaki "(Safety
     * Training)" notundan sahte bir HF/SMS kaydı üretmesi, karşılığı olmayan
     * belge yaratıyordu; bir kez temizlendi. Burası artık yalnızca kâğıtta
     * TARİH yazan hücreleri aktarır, notlar rapora düşer.
     */
    for (const [col, cell] of Object.entries(p.cells)) {
      const title = COURSE_BY_COLUMN[col];
      if (!title) {
        if (cell.completed) skipped.noCourse.push(p.name + " · " + col);
        continue;
      }
      if (cell.note) {
        (/^planned$/i.test(cell.note) ? skipped.planned : skipped.note).push(
          p.name + " · " + col + " · " + cell.note
        );
        continue;
      }
      if (cell.looksLikeExpiry) {
        skipped.expiryStyle.push(p.name + " · " + col + " · " + iso(cell.completed));
        continue;
      }
      // Kalan gün hücresine yanlış değer düşmüş (ör. seri no). Tarihe güven,
      // süreyi o kolonun geri kalanından çıkan baskın süreyle tamamla.
      if (cell.unexplained != null) {
        const fallback = dominantValidity[col] ?? null;
        skipped.odd.push(
          p.name + " · " + col + " · " + iso(cell.completed) + " · kalan=" + cell.unexplained +
            " → süre kolonun baskın değeriyle alındı: " + (fallback ? fallback + " yıl" : "süresiz")
        );
        cell.validityYears = fallback;
      }
      const course = courseByTitle.get(norm(title));
      if (!course) {
        skipped.noCourse.push(p.name + " · " + col + " (kurs yok: " + title + ")");
        continue;
      }
      const expiry = cell.validityYears ? plusYears(cell.completed, cell.validityYears) : null;
      writes.push({
        id: "trng-sts-" + user.id + "-" + slug(col),
        userId: user.id,
        userName: user.displayName || user.name,
        courseId: course.id,
        courseTitle: course.title,
        column: col,
        completedAt: cell.completed,
        expiresAt: expiry,
      });
    }
  }

  const rep = (label, arr) => {
    console.log("\n" + label + ": " + arr.length);
    arr.slice(0, 200).forEach((x) => console.log("   ", x));
  };
  console.log("Kişi: " + people.length + " · yazılacak kayıt: " + writes.length);
  rep("Sistemde hesabı olmayan kişi (atlandı)", [...new Set(skipped.noUser)]);
  rep("PLANNED (henüz alınmamış, atlandı)", skipped.planned);
  rep("Tarih yerine not yazılmış (atlandı)", skipped.note);
  rep("Hücre bitiş tarihi gibi girilmiş (atlandı, kontrol et)", skipped.expiryStyle);
  rep("Kalan gün açıklanamadı (atlandı, kontrol et)", skipped.odd);
  rep("Sistemde kursu olmayan eğitim (atlandı)", skipped.noCourse);

  const byCourse = {};
  writes.forEach((w) => (byCourse[w.courseTitle] = (byCourse[w.courseTitle] || 0) + 1));
  console.log("\nKurs başına kayıt:");
  Object.entries(byCourse)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log("   ", String(v).padStart(3), k));

  if (!APPLY) {
    console.log("\n[dry run] Hiçbir şey yazılmadı. Yazmak için: --apply");
    return;
  }

  let n = 0;
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      batch.set(
        db.doc("externalTrainings/" + w.id),
        {
          userId: w.userId,
          userName: w.userName,
          userDepartmentId: null,
          title: w.courseTitle,
          provider: "BonAir Aviation — past record (TRNG_STS)",
          courseId: w.courseId,
          courseTitle: w.courseTitle,
          completedAt: Timestamp.fromDate(w.completedAt),
          expiresAt: w.expiresAt ? Timestamp.fromDate(w.expiresAt) : null,
          durationHours: null,
          externalSerialNo: null,
          notes: w.coveredBy
            ? "Kâğıt matriste " + w.coveredBy + " kapsamında işaretliydi."
            : "Kâğıt eğitim takip tablosundan (TRNG_STS) aktarıldı.",
          importedFrom: "TRNG_STS",
          sourceColumn: w.column,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      n++;
    }
    await batch.commit();
    console.log("yazıldı: " + Math.min(i + 400, writes.length) + "/" + writes.length);
  }

  // Açık atamaları kapat — kişi eğitimi zaten almış.
  let closed = 0;
  for (const w of writes) {
    const ref = db.doc("assignments/" + w.userId + "_" + w.courseId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const a = snap.data();
    if (a.status === "COMPLETED" || a.status === "EXAM_PASSED") continue;
    await ref.update({
      status: "COMPLETED",
      completedAt: Timestamp.fromDate(w.completedAt),
      completedVia: "EXTERNAL",
      externalTrainingId: w.id,
    });
    closed++;
  }
  console.log("\nYazılan kayıt: " + n + " · kapatılan atama: " + closed);
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
