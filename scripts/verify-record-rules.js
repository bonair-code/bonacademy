/**
 * `lib/records.ts`'e taşınan kuralların ESKİ satır içi kodla aynı sonucu
 * verdiğini doğrular.
 *
 * Neden: "bu kişi bu eğitimi aldı mı, ne zamana kadar geçerli" hesabı dört
 * ekranda ayrı ayrı yazılmıştı ve `TrainingMatrix` içindeki yorum sonucu kayda
 * geçmiş: üç ekran aynı kişi için farklı cevap veriyordu. Kuralı tek yere
 * taşırken aynı hatayı tersinden yapmamak gerekiyor — bu script canlı veriyle
 * iki uygulamayı yan yana koşturup her (kişi × kurs) hücresini karşılaştırır.
 *
 * Kullanım: node scripts/verify-record-rules.js
 * Çıktı: fark sayısı. 0 beklenir.
 */
const path = require("path");
const { createRequire } = require("module");
const fnRequire = createRequire(path.join(__dirname, "../functions/package.json"));
const { initializeApp } = fnRequire("firebase-admin/app");
const { getFirestore } = fnRequire("firebase-admin/firestore");

initializeApp({ projectId: "bonair-academy" });
const db = getFirestore();

const DAY = 86400000;

/* ---------------- ESKİ: ekranlardan birebir kopyalanmış satır içi kod ------- */

function oldAddValidity(base, every, unit) {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

function oldCompletions(certs, externals) {
  const m = new Map();
  const put = (uid, cid, d) => {
    if (!uid || !cid || !d) return;
    const k = `${uid}|${cid}`;
    const prev = m.get(k);
    if (!prev || d.date > prev.date) m.set(k, d);
  };
  for (const c of certs) {
    const date = c.issuedAt?.toDate?.();
    if (date) put(c.userId, c.courseId, { date, external: null });
  }
  for (const e of externals) {
    const date = e.completedAt?.toDate?.();
    if (date)
      put(e.userId, e.courseId, {
        date,
        external: e.provider ?? "External",
        expiresAt: e.expiresAt?.toDate?.() ?? null,
      });
  }
  return m;
}

function oldAssignedSet(assignments) {
  return new Set(
    assignments
      .filter((a) => a.status !== "COMPLETED" && a.status !== "EXAM_PASSED")
      .map((a) => `${a.userId}|${a.courseId}`)
  );
}

function oldMethodRecords(externals) {
  const m = new Map();
  for (const e of externals) {
    const date = e.completedAt?.toDate?.();
    if (!date || !e.userId || !e.courseId) continue;
    const k = `${e.userId}|${e.courseId}`;
    m.set(k, [
      ...(m.get(k) ?? []),
      { method: e.method ?? null, date, expiry: e.expiresAt?.toDate?.() ?? null },
    ]);
  }
  return m;
}

/* ---------------- YENİ: lib/records.ts ile aynı kural --------------------- */

const keyOf = (u, c) => `${u}|${c}`;

function newAddValidity(base, every, unit) {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

function pickLatest(map, key, cand) {
  if (!cand) return;
  const prev = map.get(key);
  if (!prev || cand.date > prev.date) map.set(key, cand);
}

function newCompletions(certs, externals) {
  const m = new Map();
  for (const c of certs) {
    const date = c.issuedAt?.toDate?.();
    if (date && c.userId && c.courseId)
      pickLatest(m, keyOf(c.userId, c.courseId), { date, external: false });
  }
  for (const e of externals) {
    const date = e.completedAt?.toDate?.();
    if (date && e.userId && e.courseId)
      pickLatest(m, keyOf(e.userId, e.courseId), {
        date,
        external: true,
        externalExpiry: e.expiresAt?.toDate?.() ?? null,
      });
  }
  return m;
}

function expiryOf(done, course) {
  if (done.external) return done.externalExpiry ?? null;
  return newAddValidity(done.date, course.recurrenceEvery, course.recurrenceUnit);
}

const isAssignmentDone = (s) => s === "COMPLETED" || s === "EXAM_PASSED";

function newOpenAssignmentSet(assignments) {
  const s = new Set();
  for (const a of assignments) {
    if (isAssignmentDone(a.status)) continue;
    if (a.userId && a.courseId) s.add(keyOf(a.userId, a.courseId));
  }
  return s;
}

function newMethodRecordIndex(externals) {
  const m = new Map();
  for (const e of externals) {
    const date = e.completedAt?.toDate?.();
    if (!date || !e.userId || !e.courseId) continue;
    const k = keyOf(e.userId, e.courseId);
    m.set(k, [
      ...(m.get(k) ?? []),
      { method: e.method ?? null, date, expiry: e.expiresAt?.toDate?.() ?? null },
    ]);
  }
  return m;
}

/* ---------------- Karşılaştırma ------------------------------------------ */

const days = (d) => (d ? Math.round((d.getTime() - Date.now()) / DAY) : null);

(async () => {
  const [users, courses, certs, externals, assignments] = await Promise.all([
    db.collection("users").get(),
    db.collection("courses").get(),
    db.collection("certificates").get(),
    db.collection("externalTrainings").get(),
    db.collection("assignments").get(),
  ]);

  const U = users.docs.map((d) => ({ id: d.id, ...d.data() }));
  const C = courses.docs.map((d) => ({ id: d.id, ...d.data() }));
  const certRows = certs.docs.map((d) => d.data());
  const extRows = externals.docs.map((d) => d.data());
  const asgRows = assignments.docs.map((d) => d.data());

  const oldDone = oldCompletions(certRows, extRows);
  const newDone = newCompletions(certRows, extRows);
  const oldAsg = oldAssignedSet(asgRows);
  const newAsg = newOpenAssignmentSet(asgRows);
  const oldMeth = oldMethodRecords(extRows);
  const newMeth = newMethodRecordIndex(extRows);

  let cells = 0;
  const diffs = [];

  for (const u of U) {
    for (const c of C) {
      cells++;
      const k = `${u.id}|${c.id}`;

      // Kazanan kayıt tarihi
      const o = oldDone.get(k);
      const n = newDone.get(k);
      if (!!o !== !!n) {
        diffs.push(`${u.name} · ${c.title}: varlık farkı (eski=${!!o} yeni=${!!n})`);
        continue;
      }
      if (o && n) {
        if (o.date.getTime() !== n.date.getTime())
          diffs.push(`${u.name} · ${c.title}: tamamlama tarihi farklı`);

        const oExp = o.external
          ? o.expiresAt ?? null
          : oldAddValidity(o.date, c.recurrenceEvery, c.recurrenceUnit);
        const nExp = expiryOf(n, c);
        if ((oExp?.getTime() ?? null) !== (nExp?.getTime() ?? null))
          diffs.push(
            `${u.name} · ${c.title}: bitiş farklı (eski=${oExp} yeni=${nExp})`
          );
        if (days(oExp) !== days(nExp))
          diffs.push(`${u.name} · ${c.title}: kalan gün farklı`);
      }

      // Açık atama
      if (oldAsg.has(k) !== newAsg.has(k))
        diffs.push(`${u.name} · ${c.title}: atama kümesi farklı`);

      // Metod kayıtları
      const om = oldMeth.get(k) ?? [];
      const nm = newMeth.get(k) ?? [];
      if (om.length !== nm.length) {
        diffs.push(`${u.name} · ${c.title}: metod kayıt sayısı farklı`);
      } else {
        for (let i = 0; i < om.length; i++) {
          if (
            om[i].method !== nm[i].method ||
            om[i].date.getTime() !== nm[i].date.getTime() ||
            (om[i].expiry?.getTime() ?? null) !== (nm[i].expiry?.getTime() ?? null)
          ) {
            diffs.push(`${u.name} · ${c.title}: metod kaydı ${i} farklı`);
            break;
          }
        }
      }
    }
  }

  console.log(`${U.length} kişi × ${C.length} kurs = ${cells} hücre karşılaştırıldı.`);
  console.log(`kayıt: ${certRows.length} sertifika, ${extRows.length} dış, ${asgRows.length} atama`);
  console.log(`\nFARK: ${diffs.length}`);
  for (const d of diffs.slice(0, 40)) console.log("  - " + d);
  if (diffs.length > 40) console.log(`  … ve ${diffs.length - 40} tane daha`);
  process.exit(diffs.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
