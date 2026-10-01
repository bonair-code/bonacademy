import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { randomBytes } from "crypto";
import { makeSsoHandler } from "./sso";

// firebase-admin v14 ad-alanlı API'yi kaldırdı (admin.firestore() vb.); modüler
// giriş noktaları kullanılıyor.
initializeApp();

// CUSTOMER: dışarıdan eğitim alan müşteri. Personel değil — yetki kapsamı
// taşımaz, kurum uyum raporlarına girmez, yalnızca kendi eğitimine erişir.
const ROLES = ["ADMIN", "MANAGER", "INSTRUCTOR", "USER", "CUSTOMER"];

/**
 * Admin, yeni bir kullanıcı (Auth hesabı + users/{uid} profili) oluşturur.
 * Client'tan Auth kullanıcısı yaratılamaz; admin SDK gerekir.
 */
export const createUser = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const caller = await getFirestore().doc(`users/${req.auth.uid}`).get();
  if (caller.data()?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");

  const d = req.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  const name = String(d.name || "").trim();
  if (!email || !name) throw new HttpsError("invalid-argument", "Email and name are required.");
  const role = ROLES.includes(d.role) ? d.role : "USER";
  const departmentId = d.departmentId ? String(d.departmentId) : null;
  const jobTitleIds: string[] = Array.isArray(d.jobTitleIds) ? d.jobTitleIds.map(String) : [];
  // Kapsam altındaki tikli alt yetkiler — kendi gerekli eğitimlerini getirir.
  const subScopeIds: string[] = Array.isArray(d.subScopeIds) ? d.subScopeIds.map(String) : [];
  // Sertifikada "PLACE & DATE of BIRTH" satırı için gerekli.
  const birthPlace = d.birthPlace ? String(d.birthPlace).trim() : null;
  const birthDate = d.birthDate ? String(d.birthDate).trim() : null; // YYYY-MM-DD
  // Müşteri hangi kuruma bağlı — "X şirketinin aldığı eğitimler" raporu için.
  const company = d.company ? String(d.company).trim() : null;
  // Metod bazlı eğitimlerde kişinin yetkili olduğu metodlar: { courseId: ["PT","MT"] }
  const courseMethods = sanitizeCourseMethods(d.courseMethods);
  const password = d.password ? String(d.password) : randomBytes(9).toString("base64") + "Aa1!";

  let userRecord;
  try {
    userRecord = await getAuth().createUser({ email, password, displayName: name });
  } catch (e) {
    throw new HttpsError("already-exists", "Could not create the user: " + (e as Error).message);
  }
  // Rolü custom claim'e de yaz (ileride claim-tabanlı kurallara geçiş için hazır).
  await getAuth().setCustomUserClaims(userRecord.uid, { role, departmentId });
  await getFirestore().doc(`users/${userRecord.uid}`).set({
    email,
    name,
    role,
    departmentId,
    jobTitleIds,
    subScopeIds,
    birthPlace,
    birthDate,
    company,
    courseMethods,
    // Admin geçici şifre verdi; kullanıcı ilk girişte değiştirmek zorunda.
    mustChangePassword: true,
    isActive: true,
    locale: "tr",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { uid: userRecord.uid };
});

/**
 * { courseId: ["PT","MT"] } biçimini temizler. Boş kalan kurslar atılır ki
 * doküman zamanla ölü anahtarlarla şişmesin.
 */
function sanitizeCourseMethods(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const clean = list.map(String).map((s) => s.trim()).filter(Boolean);
    if (clean.length) out[String(k)] = Array.from(new Set(clean));
  }
  return out;
}

/** Çağıranın ADMIN olduğunu doğrular, değilse hata fırlatır. */
async function assertAdmin(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const caller = await getFirestore().doc(`users/${uid}`).get();
  if (caller.data()?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");
}

/**
 * Kullanıcı profilini günceller. Rol/departman değişince custom claim'i de
 * yeniler — aksi halde token eski rolü taşımaya devam eder (Storage kuralları
 * ve arayüz claim'e bakıyor).
 */
export const updateUser = onCall({ region: "europe-west3" }, async (req) => {
  await assertAdmin(req.auth?.uid);

  const uid = String(req.data?.uid || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  const snap = await getFirestore().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");

  const d = req.data || {};
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof d.name === "string" && d.name.trim()) patch.name = d.name.trim();
  if (ROLES.includes(d.role)) patch.role = d.role;
  if (d.departmentId !== undefined) patch.departmentId = d.departmentId ? String(d.departmentId) : null;
  if (Array.isArray(d.jobTitleIds)) patch.jobTitleIds = d.jobTitleIds.map(String);
  if (Array.isArray(d.subScopeIds)) patch.subScopeIds = d.subScopeIds.map(String);
  if (d.birthPlace !== undefined) patch.birthPlace = d.birthPlace ? String(d.birthPlace).trim() : null;
  if (d.birthDate !== undefined) patch.birthDate = d.birthDate ? String(d.birthDate).trim() : null;
  if (d.company !== undefined) patch.company = d.company ? String(d.company).trim() : null;
  if (d.courseMethods !== undefined) patch.courseMethods = sanitizeCourseMethods(d.courseMethods);
  if (typeof d.isActive === "boolean") patch.isActive = d.isActive;

  await snap.ref.update(patch);

  const role = (patch.role as string) ?? snap.data()?.role ?? "USER";
  const departmentId =
    patch.departmentId !== undefined ? patch.departmentId : snap.data()?.departmentId ?? null;
  await getAuth().setCustomUserClaims(uid, { role, departmentId });

  // Pasifleştirilen kullanıcı Auth tarafında da giriş yapamasın.
  if (typeof d.isActive === "boolean") {
    await getAuth().updateUser(uid, { disabled: !d.isActive });
  }
  return { ok: true };
});

/**
 * Kullanıcıyı siler: Auth hesabı + users/{uid} profili. Eğitim kayıtları
 * (assignments/certificates) BİLEREK silinmez — havacılık eğitim kayıtları
 * saklanmak zorunda; kayıt silmek gerekirse ayrı ve bilinçli bir iş olmalı.
 */
export const deleteUser = onCall({ region: "europe-west3" }, async (req) => {
  await assertAdmin(req.auth?.uid);

  const uid = String(req.data?.uid || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (uid === req.auth!.uid)
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");

  try {
    await getAuth().deleteUser(uid);
  } catch {
    // Auth kaydı zaten yoksa profili temizlemeye devam et.
  }
  await getFirestore().doc(`users/${uid}`).delete();
  return { ok: true };
});

/**
 * Bir bölümün gerçekten içeriği var mı? İçerik, bölüm dokümanındaki `contents`
 * dizisinde tutuluyor; tek içerikli eski kayıtlarda `content` alanında.
 *
 * Boş kabuk bölüm ("Bölüm 1" yazıp içine bir şey koymamak) öğrenci tarafında
 * "No content in this section" ekranı demek — bölüm SAYMAK yeterli değil.
 */
function sectionHasContent(d: any): boolean {
  const s = d ?? {};
  if (Array.isArray(s.contents)) return s.contents.length > 0;
  return s.content != null;
}

/**
 * Kursun yayına çıkmasını engelleyen sebepler. Boş dizi = yayınlanabilir.
 *
 * Tek gerçek zorlama noktası burası: `isActive` eskiden istemciden doğrudan
 * yazılıyordu, bu yüzden içi bomboş altı kurs yayında kalmıştı ve atanan kişi
 * `/learn`'de hiç ilerleyemiyordu (bölüm yok → tamamla düğmesi yok → durum
 * PENDING'de donuyor).
 *
 * EXTERNAL_ONLY (takip edilen dış eğitim) istisna: onun içeriği bizde değil,
 * kişinin elindeki belgede.
 */
function publishBlockers(
  c: any,
  sections: { data(): any }[],
  questions: { data(): any }[],
  lang: Lang
): string[] {
  if ((c?.delivery ?? "ONLINE") === "EXTERNAL_ONLY") return [];
  const mine = sections.filter((d) => asLang(d.data().lang) === lang);
  const myQs = questions.filter((d) => asLang(d.data().lang) === lang);
  const out: string[] = [];
  if (mine.length === 0) {
    out.push("This language has no sections yet.");
  } else if (!mine.some((d) => sectionHasContent(d.data()))) {
    out.push("Sections exist but none has any content (add a video, PDF or SCORM package).");
  }
  if (c?.exam?.required && myQs.length === 0)
    out.push("The exam is required but this language has no questions.");
  return out;
}

/** Kursun yayınlanmış dilleri — bozuk alan güvenli listeye indirgenir. */
function publishedLangsOf(c: any): Lang[] {
  const raw = Array.isArray(c?.publishedLangs) ? c.publishedLangs : [];
  const set = new Set(raw.map(asLang));
  return (["TR", "EN"] as Lang[]).filter((l) => set.has(l));
}

/**
 * Kursu yayınlar/yayından alır ve revizyonu arşivler. Her yayın, o anki kurs
 * halinin anlık kopyasını courses/{cid}/revisions/{n} altına yazar — güvenlik
 * kuralları bu koleksiyona client yazmasına izin vermiyor (denetim izi
 * bozulmasın).
 *
 * `isActive` SADECE buradan yazılır; güvenlik kuralı istemcinin bu alana
 * dokunmasını engelliyor.
 */
export const publishCourse = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();

  const courseId = String(req.data?.courseId || "");
  if (!courseId) throw new HttpsError("invalid-argument", "courseId is required.");
  const ref = db.doc(`courses/${courseId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Course not found.");
  const c = snap.data() as any;

  // Admin her kursu, eğitmen yalnızca sahibi olduğu kursu yayınlayabilir.
  const isOwner = c.ownerInstructorId === req.auth.uid;
  if (caller?.role !== "ADMIN" && !isOwner)
    throw new HttpsError("permission-denied", "You are not allowed to publish this course.");

  // Yayın DİL BAŞINA. Türkçeyi bitirip yayınlamak, İngilizceyi sonra ayrıca
  // kurup ayrıca yayınlamak mümkün; öğrenci yalnızca yayınlanmış dilleri görür,
  // yarım kalmış bir çeviri kimseye görünmez.
  const lang = asLang(req.data?.lang);
  const active = req.data?.active === undefined ? true : Boolean(req.data.active);
  const current = publishedLangsOf(c);

  // Yayından ALMA hiçbir ön koşul istemez ve BURADA, her kontrolden önce
  // duruyor: yanlışlıkla yayınlanmış ya da içi boşalmış bir sürüm her zaman
  // geri çekilebilmeli. Aşağıdaki Revision No kontrolünün altında kalsaydı,
  // revizyon numarası olmayan bir kurs yayından da alınamazdı.
  if (!active) {
    const next = current.filter((l) => l !== lang);
    await ref.update({
      publishedLangs: next,
      // Hiç yayınlanmış dil kalmadıysa kurs da yayında değildir. `isActive`
      // tek bir yerden türüyor ki liste, atama ve matris aynı cevabı versin.
      isActive: next.length > 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { active: false, lang, publishedLangs: next };
  }

  // Revizyon numarası ELLE girilir (kurs formundaki Revision No alanı).
  // Function numarayı üretmez; yalnızca o anki halin kopyasını arşivler.
  const revisionNo = String(c.revisionNo ?? "").trim();
  if (!revisionNo)
    throw new HttpsError(
      "failed-precondition",
      "Revision No is empty — fill it in under General Information before publishing."
    );
  const note = req.data?.note ? String(req.data.note).trim().slice(0, 500) : null;

  const [sections, questions] = await Promise.all([
    db.collection(`courses/${courseId}/sections`).get(),
    db.collection(`courses/${courseId}/questions`).get(),
  ]);

  const blockers = publishBlockers(c, sections.docs, questions.docs, lang);
  if (blockers.length)
    throw new HttpsError("failed-precondition", blockers.join(" "));

  const mySections = sections.docs.filter((d) => asLang((d.data() as any).lang) === lang);
  const myQuestions = questions.docs.filter((d) => asLang((d.data() as any).lang) === lang);

  // Append-only arşiv: aynı revizyon numarası tekrar yayınlanabilir, her yayın
  // ayrı kayıt olur — denetim izi bozulmasın.
  await db.collection(`courses/${courseId}/revisions`).add({
    revisionNo,
    revisionDate: c.revisionDate ?? null,
    lang,
    note,
    publishedById: req.auth.uid,
    publishedByName: caller?.name || "",
    publishedAt: FieldValue.serverTimestamp(),
    // Anlık kopya — kurs sonradan değişse de bu revizyonun içeriği sabit kalır.
    snapshot: {
      title: c.title ?? "",
      category: c.category ?? null,
      durationHours: c.durationHours ?? null,
      delivery: c.delivery ?? "ONLINE",
      recurrenceEvery: c.recurrenceEvery ?? null,
      recurrenceUnit: c.recurrenceUnit ?? "NONE",
      revisionNo,
      revisionDate: c.revisionDate ?? null,
      passingScore: c.passingScore ?? null,
      isActive: c.isActive ?? false,
      exam: c.exam ?? null,
      // Arşiv yalnızca yayınlanan DİLİN anlık kopyası; diğer dilin bölümleri
      // bu revizyona karışmamalı.
      sectionCount: mySections.length,
      questionCount: myQuestions.length,
      sectionTitles: mySections
        .map((d) => ({ order: (d.data() as any).order ?? 0, title: (d.data() as any).title ?? "" }))
        .sort((a, b) => a.order - b.order)
        .map((x) => x.title),
    },
  });

  const nextLangs = current.includes(lang) ? current : [...current, lang];
  await ref.update({
    publishedLangs: nextLangs,
    isActive: true,
    lastPublishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { revisionNo, active: true };
});

/**
 * Bir personele eğitim(ler) atar. Atama durum geçişleri güvenlik gereği
 * yalnızca Function tarafından yazılır. Deterministik id ({userId}_{courseId})
 * → aynı eğitim ikinci kez atanmaz (idempotent).
 */
export const assignCourses = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const caller = await getFirestore().doc(`users/${req.auth.uid}`).get();
  const callerRole = caller.data()?.role;
  // Eğitim atamak eğitimi verenin işi: admin ve eğitmen. Müdür personelinin
  // durumunu görür ve dış eğitim kaydı girer, ama atama yapmaz.
  if (callerRole !== "ADMIN" && callerRole !== "INSTRUCTOR")
    throw new HttpsError("permission-denied", "This action is for admins and instructors.");

  const userId = String(req.data?.userId || "");
  const courseIds: string[] = Array.isArray(req.data?.courseIds)
    ? req.data.courseIds.map(String)
    : [];
  if (!userId || courseIds.length === 0)
    throw new HttpsError("invalid-argument", "userId and courseIds are required.");

  const db = getFirestore();
  const userSnap = await db.doc(`users/${userId}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const userDepartmentId = userSnap.data()?.departmentId ?? null;

  // Son teslim süresi çağrıdan gelebilir (matristeki atama penceresi kullanıyor).
  const rawDue = Number(req.data?.dueDays);
  const dueDays = Number.isFinite(rawDue) ? Math.min(Math.max(Math.round(rawDue), 1), 365) : 30;

  const now = Timestamp.now();
  const dueDate = Timestamp.fromMillis(now.toMillis() + dueDays * 24 * 3600 * 1000);

  let created = 0;
  const skipped: { courseId: string; reason: string }[] = [];
  for (const courseId of courseIds) {
    const courseSnap = await db.doc(`courses/${courseId}`).get();
    if (!courseSnap.exists) {
      skipped.push({ courseId, reason: "Course not found." });
      continue;
    }
    const course = courseSnap.data() as any;

    // Yayında olmayan ya da hiçbir dili yayınlanmamış kursa atama yapılmaz —
    // kişi açtığında yapacak bir şey bulamaz ve atama sonsuza kadar PENDING
    // kalır.
    if (course.isActive === false) {
      skipped.push({ courseId, reason: "The course is not published." });
      continue;
    }
    const langs = publishedLangsOf(course);
    if (langs.length === 0) {
      skipped.push({ courseId, reason: "The course has no published language." });
      continue;
    }

    const id = `${userId}_${courseId}`;
    const ref = db.doc(`assignments/${id}`);
    if ((await ref.get()).exists) {
      skipped.push({ courseId, reason: "Already assigned." });
      continue; // idempotent
    }
    await ref.set({
      userId,
      userDepartmentId,
      courseId,
      courseTitle: course.title || "",
      status: "PENDING",
      cycleNumber: 1,
      sectionsDone: [],
      // Atamanın dili: kişinin profil dili yayınlanmışsa o, değilse yayınlanmış
      // ilk dil. Birden çok dil varsa öğrenci eğitime girerken kendisi seçiyor
      // (setAssignmentLanguage).
      contentLanguage: langs.includes(asLang(userSnap.data()?.locale))
        ? asLang(userSnap.data()?.locale)
        : langs[0],
      dueDate,
      triggeredBy: "MANAGER_REQUESTED",
      triggeredById: req.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  // `skipped` geri dönüyor: arayüz "20 kişiye atadım" deyip 12'sini sessizce
  // atlamasın, sebebini gösterebilsin.
  return { created, skipped };
});

/**
 * Dışarıdan alınan eğitim, aynı kursun açık atamasını kapatır — kişi o eğitimi
 * zaten aldıysa sistemde tekrar yapmasına gerek yok.
 *
 * BonAir sertifikası ÜRETİLMEZ: eğitimi biz vermedik, elimizde onların belgesi
 * var. Durum COMPLETED ama completedVia = EXTERNAL olarak işaretlenir.
 */
export const closeAssignmentExternally = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  const role = caller?.role;
  if (role !== "ADMIN" && role !== "MANAGER")
    throw new HttpsError("permission-denied", "This action is for admins and managers.");

  const userId = String(req.data?.userId || "");
  const courseId = String(req.data?.courseId || "");
  const externalTrainingId = req.data?.externalTrainingId
    ? String(req.data.externalTrainingId)
    : null;
  if (!userId || !courseId)
    throw new HttpsError("invalid-argument", "userId and courseId are required.");

  // Müdür yalnızca kendi departmanındaki personel için.
  const target = (await db.doc(`users/${userId}`).get()).data();
  if (role === "MANAGER" && target?.departmentId !== caller?.departmentId)
    throw new HttpsError("permission-denied", "That person is not in your department.");

  const ref = db.doc(`assignments/${userId}_${courseId}`);
  const snap = await ref.get();
  if (!snap.exists) return { closed: false, reason: "no-assignment" };

  const a = snap.data() as any;
  if (a.status === "COMPLETED" || a.status === "EXAM_PASSED")
    return { closed: false, reason: "already-complete" };

  await ref.update({
    status: "COMPLETED",
    completedAt: FieldValue.serverTimestamp(),
    completedVia: "EXTERNAL",
    externalTrainingId,
  });
  return { closed: true };
});

// ─────────────────────────────────────────────────────────────
// ÖĞRENCI AKIŞI — ilerleme, sınav, sertifika (server-authoritative)
// ─────────────────────────────────────────────────────────────

async function loadOwnedAssignment(uid: string, assignmentId: string) {
  const db = getFirestore();
  const snap = await db.doc(`assignments/${assignmentId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const a = snap.data() as any;
  if (a.userId !== uid) throw new HttpsError("permission-denied", "This assignment is not yours.");
  return { ref: snap.ref, a };
}

/**
 * Eğitim içeriğinin dili. Atamada tutuluyor: aynı eğitimin iki dili tek kurs,
 * kişi hangisinde çalıştıysa kaydı o söylüyor.
 */
type Lang = "TR" | "EN";
const asLang = (v: unknown): Lang => (String(v).toUpperCase() === "EN" ? "EN" : "TR");

/** Bir dilin soru bankası. Her dil sürümünün kendi soruları var. */
async function courseQuestions(courseId: string, lang: Lang) {
  const snap = await getFirestore().collection(`courses/${courseId}/questions`).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((q) => asLang(q.lang) === lang);
}

/** Bir dilin bölümleri, sırasıyla. */
async function courseSections(courseId: string, lang: Lang) {
  const snap = await getFirestore()
    .collection(`courses/${courseId}/sections`)
    .orderBy("order")
    .get();
  return snap.docs.filter((d) => asLang((d.data() as any).lang) === lang);
}

type ExamInfo = { required: boolean; score?: number | null; passingScore?: number | null };

/**
 * TEK sertifika numarası kaynağı.
 *
 * Eskiden iki ayrı seri vardı: online tamamlamalar `BA-00001`, sınıf eğitimi
 * ise oturumda elle girilen ön ek + başlangıç numarası. Aynı sicilde iki farklı
 * numaralandırma denetimde savunulamaz — artık ikisi de buradan alıyor.
 *
 * Biçim `counters/certificates` dokümanında tutulur:
 *   { year: "26", prefix: "26", next: 44, pad: 3 }  →  "26-044"
 * Numara transaction ile artar, aynı anda iki sertifika üretilse bile çakışmaz.
 */
/**
 * Doğrulama anahtarı. QR bunu taşır, sertifika numarasını DEĞİL.
 *
 * Numaralar sıralı (26-001, 26-002…); QR adresi numaraya dayanırsa herkese
 * açık doğrulama sayfasından sırayla girilip bütün personelin adı ve aldığı
 * eğitim dökülebilir. Tahmin edilemez anahtar bunu kapatır: yalnızca elinde
 * belge olan doğrulayabilir.
 */
function newVerifyToken(): string {
  return randomBytes(16).toString("base64url");
}

/** İçinde bulunulan yılın iki haneli kodu — sicil ön eki. */
function serialYear(): string {
  return String(new Date().getFullYear()).slice(-2);
}

/**
 * Sıradaki sertifika numaraları. Ön ek YILDIR ve sayaç her yıl başında
 * kendiliğinden birden başlar: 26-001 … 26-042, sonra 2027'de 27-001.
 *
 * Ön ek elle girilmiyor — yılı yanlış yazmak sicili sessizce bozardı ve
 * numara bir kez verildikten sonra geri alınamaz.
 */
async function nextSerialNo(count = 1): Promise<string[]> {
  const db = getFirestore();
  const ref = db.doc("counters/certificates");
  const year = serialYear();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() as any) || {};
    const pad = Number(d.pad) || 3;
    // Yıl değiştiyse seri sıfırlanır; aynı yıl içinde kaldığı yerden sürer.
    // Eski sayaç yalnızca `value` tutuyordu; ilk geçişte ondan devam et.
    const sameYear = String(d.year ?? "") === year;
    const start = sameYear ? Number(d.next ?? (d.value ?? 0) + 1) || 1 : 1;
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(`${year}-${String(start + i).padStart(pad, "0")}`);
    }
    tx.set(ref, { year, prefix: year, pad, next: start + count }, { merge: true });
    return out;
  });
}

async function issueCertificateFor(assignmentId: string, a: any, exam?: ExamInfo) {
  const db = getFirestore();
  const certRef = db.doc(`certificates/${assignmentId}`);
  if ((await certRef.get()).exists) return;
  const userSnap = await db.doc(`users/${a.userId}`).get();
  const user = userSnap.data() || {};
  const userName = user.name || "";

  // Sertifika bir KAYITTIR: kurs sonradan düzenlense bile belge değişmemeli,
  // bu yüzden gerekli tüm alanlar burada dondurulur.
  const courseSnap = await db.doc(`courses/${a.courseId}`).get();
  const course = courseSnap.data() || {};
  let instructorName = "";
  if (course.ownerInstructorId) {
    const ins = await db.doc(`users/${course.ownerInstructorId}`).get();
    instructorName = ins.data()?.name || "";
  }
  const org = (await db.doc("orgSettings/singleton").get()).data() || {};
  const [serialNo] = await nextSerialNo();
  const verifyToken = newVerifyToken();
  const now = FieldValue.serverTimestamp();
  await certRef.set({
    assignmentId,
    userId: a.userId,
    userName,
    // Müdürün kendi departmanının sertifikalarını okuyabilmesi için gerekli —
    // güvenlik kuralı bu alana bakıyor.
    userDepartmentId: a.userDepartmentId ?? null,
    courseId: a.courseId,
    courseTitle: a.courseTitle,
    serialNo,
    issuedAt: now,
    // — dondurulan alanlar —
    birthPlace: user.birthPlace ?? null,
    birthDate: user.birthDate ?? null,
    durationHours: course.durationHours ?? null,
    // Hangi kurs revizyonunda eğitim alındığı — denetimde ilk sorulan şey.
    // Kurs sonradan revize edilse bile bu belge o günkü sürümü gösterir.
    courseRevisionNo: course.revisionNo ?? null,
    courseRevisionDate: course.revisionDate ?? null,
    // Online eğitimde imzalayan bir eğitmen YOK — belgeyi kurumun eğitim
    // sistemi üretti. Kursu hazırlayan kişiyi imza hanesine yazmak yanıltıcı.
    instructorName: null,
    trainingStartedAt: a.startedAt ?? null,
    trainingCompletedAt: a.completedAt ?? null,
    examRequired: exam?.required ?? true,
    examScore: exam?.score ?? null,
    examPassingScore: exam?.passingScore ?? null,
    heldIn: org.trainingLocation ?? "ONLINE",
    organisationName: org.organisationName ?? "BONAIR AVIATION MAINTENANCE ORGANISATION",
    approvalNo: org.approvalNo ?? "TR.145.118",
    verifyToken,
  });
  await db.doc(`certVerify/${verifyToken}`).set({
    serialNo,
    name: userName,
    courseTitle: a.courseTitle,
    issuedAt: now,
  });
}

/** Bir bölümü tamamlar (sıralı zorunluluk kontrolüyle). Hepsi bitince sınav
 *  varsa SECTIONS_DONE, yoksa COMPLETED + sertifika. */
export const completeSection = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId, sectionId } = req.data || {};
  const { ref, a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  if (a.status === "COMPLETED") return { status: "COMPLETED" };

  // Bölümler kişinin aldığı DİLE ait olanlar. Diller ayrı sürüm olduğu için
  // başka dilin bölümünü tamamlamak ilerlemeyi bozardı.
  const lang = asLang(a.contentLanguage);
  const sections = (await courseSections(a.courseId, lang)).map((d) => d.id);
  if (sections.length === 0)
    throw new HttpsError("failed-precondition", "This language has no sections.");
  if (!sections.includes(String(sectionId)))
    throw new HttpsError("invalid-argument", "Unknown section.");

  const done: string[] = Array.isArray(a.sectionsDone) ? a.sectionsDone : [];
  // Sıralı zorunluluk: bu bölüm, tamamlanmamış ilk bölüm olmalı.
  const nextExpected = sections.find((s) => !done.includes(s));
  if (nextExpected !== String(sectionId))
    throw new HttpsError("failed-precondition", "Sections must be completed in order.");

  const newDone = [...done, String(sectionId)];
  const allDone = sections.every((s) => newDone.includes(s));
  let status = "IN_PROGRESS";
  if (allDone) {
    // Sınav yalnızca kurs sınav istiyorsa VE bankada soru varsa devreye girer.
    // exam.required alanı eski kayıtlarda yok; o kurslarda sınav vardı sayılır.
    const course = (await getFirestore().doc(`courses/${a.courseId}`).get()).data() as any;
    const examRequired = course?.exam?.required ?? true;
    const qs = examRequired ? await courseQuestions(a.courseId, lang) : [];
    status = qs.length > 0 ? "SECTIONS_DONE" : "COMPLETED";
  }

  await ref.update({
    sectionsDone: newDone,
    status,
    // İlk bölüm tamamlanınca eğitimin başlangıcı damgalanır; sertifikadaki
    // "On <başlangıç> - <bitiş>" satırı buna dayanıyor.
    ...(a.startedAt ? {} : { startedAt: FieldValue.serverTimestamp() }),
    ...(status === "COMPLETED" ? { completedAt: FieldValue.serverTimestamp() } : {}),
  });
  if (status === "COMPLETED")
    await issueCertificateFor(String(assignmentId), a, { required: false });
  return { status, sectionsDone: newDone };
});

/** Sınavı başlatır: soruları seçer, snapshot yazar, CEVAPSIZ döndürür. */
export const startExam = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId } = req.data || {};
  const { a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  if (a.status !== "SECTIONS_DONE" && a.status !== "EXAM_FAILED")
    throw new HttpsError("failed-precondition", "Complete every section first.");

  const db = getFirestore();
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  const exam = course?.exam || { questionCount: 10, shuffle: true };
  if (exam.required === false)
    throw new HttpsError("failed-precondition", "This course has no exam.");
  // Sınav, kişinin eğitimi aldığı dilin bankasından. Her dil sürümünün kendi
  // soruları var; dil ATAMADAN okunuyor, istemciden değil.
  const lang = asLang(a.contentLanguage);
  let qs = await courseQuestions(a.courseId, lang);
  if (qs.length === 0)
    throw new HttpsError("failed-precondition", "This language has no exam questions.");
  if (exam.shuffle) qs = qs.sort(() => Math.random() - 0.5);
  qs = qs.slice(0, Math.min(exam.questionCount || 10, qs.length));

  const attemptNo = ((a.examAttemptCount as number) || 0) + 1;
  await db.doc(`assignments/${assignmentId}/examSessions/${attemptNo}`).set({
    attemptNo,
    questionIds: qs.map((q) => q.id),
    createdAt: FieldValue.serverTimestamp(),
  });
  // Cevapları çıkararak döndür.
  return {
    attemptNo,
    language: lang,
    passingScore: exam.passingScore || course?.passingScore || 70,
    questions: qs.map((q) => ({
      id: q.id,
      text: q.text,
      options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text })),
    })),
  };
});

/**
 * Öğrencinin eğitimi hangi dilde aldığını kaydeder.
 *
 * Atama dokümanına istemci yazamıyor (güvenlik kuralı `allow write: if false`)
 * — durum geçişleri yalnızca Function'dan geçsin diye. Dil seçimi de buradan
 * geçiyor; tek yazdığı alan bu, ilerlemeye ya da duruma dokunmuyor.
 *
 * Dil bir görüntüleme tercihi değil, kaydın parçası: denetimde "bu kişi bu
 * eğitimi hangi dilde aldı" sorusunun cevabı.
 */
export const setAssignmentLanguage = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const assignmentId = String(req.data?.assignmentId || "");
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  const lang = asLang(req.data?.language);
  const { ref, a } = await loadOwnedAssignment(req.auth.uid, assignmentId);
  if (asLang(a.contentLanguage) === lang) {
    // Aynı dili seçmek de bir seçimdir: kapı bir daha çıkmamalı.
    if (!a.languageChosen) await ref.update({ languageChosen: true });
    return { language: lang };
  }

  // Tamamlanmış eğitimin dili değişmez: sertifika verildi, kayıt kapandı.
  if (a.status === "COMPLETED" || a.status === "EXAM_PASSED")
    throw new HttpsError("failed-precondition", "The language of a completed training cannot be changed.");

  const db = getFirestore();
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  if (!publishedLangsOf(course).includes(lang))
    throw new HttpsError("failed-precondition", "This training is not published in that language.");

  // Durum YENİ dilin bölümlerine göre baştan hesaplanıyor. Diller ayrı sürüm
  // olduğu için Türkçeyi bitirip "SECTIONS_DONE" olan biri dili İngilizceye
  // çevirince, İngilizce bölümleri hiç açmadan sınava girebilirdi.
  //
  // İlerleme kaybolmuyor: sectionsDone bölüm id'si tutuyor ve id'ler dile göre
  // ayrı, yani eski dile dönünce kaldığı yerden devam ediyor.
  const sections = (await courseSections(a.courseId, lang)).map((d) => d.id);
  const done: string[] = Array.isArray(a.sectionsDone) ? a.sectionsDone : [];
  const doneHere = sections.filter((id) => done.includes(id));
  const examRequired = course?.exam?.required ?? true;
  const qs = examRequired ? await courseQuestions(a.courseId, lang) : [];

  let status: string;
  if (sections.length > 0 && doneHere.length === sections.length) {
    status = qs.length > 0 ? "SECTIONS_DONE" : "COMPLETED";
  } else {
    status = doneHere.length > 0 ? "IN_PROGRESS" : "PENDING";
  }

  await ref.update({
    contentLanguage: lang,
    languageChosen: true,
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Bu dilde zaten her bölüm bitmiş ve sınav yoksa eğitim burada kapanır.
  if (status === "COMPLETED")
    await issueCertificateFor(assignmentId, { ...a, contentLanguage: lang }, { required: false });
  return { language: lang, status };
});

/** Sınavı sunucu tarafında puanlar; geçerse sertifika, 2 başarısızlıkta baştan. */
export const submitExam = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId, attemptNo, answers } = req.data || {};
  const { ref, a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  const db = getFirestore();

  const sessRef = db.doc(`assignments/${assignmentId}/examSessions/${attemptNo}`);
  const sess = (await sessRef.get()).data() as any;
  if (!sess) throw new HttpsError("not-found", "No exam session found.");
  if (sess.submittedAt) throw new HttpsError("failed-precondition", "This attempt has already been submitted.");

  const allQs = await courseQuestions(a.courseId, asLang(a.contentLanguage));
  const byId = new Map(allQs.map((q) => [q.id, q]));
  const answerMap: Record<string, string> = answers || {};
  let correct = 0;
  const picked: string[] = sess.questionIds || [];
  for (const qid of picked) {
    const q = byId.get(qid);
    if (!q) continue;
    const correctOpt = (q.options || []).find((o: any) => o.isCorrect);
    if (correctOpt && answerMap[qid] === correctOpt.id) correct++;
  }
  const score = picked.length ? Math.round((correct / picked.length) * 100) : 0;
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  const passingScore = course?.exam?.passingScore || course?.passingScore || 70;
  const passed = score >= passingScore;

  await sessRef.update({ submittedAt: FieldValue.serverTimestamp() });
  await db.doc(`assignments/${assignmentId}/examAttempts/${attemptNo}`).set({
    // userId olmadan güvenlik kuralı (isSelf(resource.data.userId)) sahibi bile
    // reddediyordu.
    userId: a.userId,
    attemptNo,
    score,
    passed,
    createdAt: FieldValue.serverTimestamp(),
  });

  if (passed) {
    await ref.update({
      status: "COMPLETED",
      examAttemptCount: attemptNo,
      completedAt: FieldValue.serverTimestamp(),
    });
    await issueCertificateFor(String(assignmentId), a, {
      required: true,
      score,
      passingScore,
    });
    return { passed, score, status: "COMPLETED" };
  }
  // Başarısız: 2. denemede baştan (bölümleri sıfırla), yoksa tekrar sınav.
  if (attemptNo >= 2) {
    await ref.update({ status: "IN_PROGRESS", sectionsDone: [], examAttemptCount: attemptNo });
    return { passed, score, status: "RETAKE_REQUIRED" };
  }
  await ref.update({ status: "EXAM_FAILED", examAttemptCount: attemptNo });
  return { passed, score, status: "EXAM_FAILED" };
});

/**
 * Yüz yüze eğitim oturumunu kapatır ve katılımcılara sertifika üretir.
 *
 * Sertifika numarası oturumu planlarken verilen başlangıçtan sırayla dağıtılır
 * (ör. 25-131, 25-132 …) — kağıt kayıtlarının devamı getirilebilsin diye.
 * Katılımcı sistemde kayıtlıysa aynı kursun açık ataması da kapatılır.
 */
export const finishClassSession = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN" && caller?.role !== "INSTRUCTOR")
    throw new HttpsError("permission-denied", "This action is for admins and instructors.");

  const sessionId = String(req.data?.sessionId || "");
  if (!sessionId) throw new HttpsError("invalid-argument", "sessionId is required.");

  const sRef = db.doc(`classSessions/${sessionId}`);
  const sSnap = await sRef.get();
  if (!sSnap.exists) throw new HttpsError("not-found", "Session not found.");
  const ses = sSnap.data() as any;
  if (ses.status === "CLOSED")
    throw new HttpsError("failed-precondition", "This session is already closed.");

  const attSnap = await db.collection(`classSessions/${sessionId}/attendees`).orderBy("signedAt").get();
  const attendees = attSnap.docs.filter((d) => (d.data() as any).rejected !== true);
  if (attendees.length === 0)
    throw new HttpsError("failed-precondition", "No attendees — no certificate can be issued.");

  const org = (await db.doc("orgSettings/singleton").get()).data() || {};
  // Numaralar merkezî sicilden, katılımcı sayısı kadar tek seferde alınır —
  // araya başka bir sertifika girip seriyi bölemesin.
  const serials = await nextSerialNo(attendees.length);
  const now = FieldValue.serverTimestamp();

  const results: { attendeeId: string; serialNo: string }[] = [];

  /**
   * Katılımcı → personel eşleşmesi BURADA yapılır.
   *
   * Eskiden QR formunda e-postadan eşleştirilmeye çalışılıyordu ama form
   * girişsiz açıldığı için güvenlik kuralları `users` okumasına izin vermiyor;
   * eşleşme sessizce boş kalıyor, dolayısıyla personelin ataması hiç
   * kapanmıyordu. Sunucu tarafında ad (ve varsa e-posta) ile eşleştiriyoruz.
   */
  const norm = (s: unknown) => String(s ?? "").trim().toLocaleLowerCase("tr");
  const usersSnap = await db.collection("users").get();
  const userByName = new Map<string, string>();
  const userByEmail = new Map<string, string>();
  for (const u of usersSnap.docs) {
    const x = u.data() as any;
    if (x.name) userByName.set(norm(x.name), u.id);
    if (x.email) userByEmail.set(norm(x.email), u.id);
  }

  for (let i = 0; i < attendees.length; i++) {
    const d = attendees[i];
    const a = d.data() as any;
    const serialNo = serials[i];
    if (!a.userId) {
      const match = (a.email ? userByEmail.get(norm(a.email)) : null) ?? userByName.get(norm(a.fullName));
      if (match) a.userId = match;
    }

    // Sertifika id'si oturum+katılımcıya bağlı → aynı oturum iki kez kapatılsa
    // bile sertifika çiftlenmez.
    const certId = `session_${sessionId}_${d.id}`;
    const verifyToken = newVerifyToken();
    await db.doc(`certificates/${certId}`).set({
      sessionId,
      attendeeId: d.id,
      userId: a.userId ?? null,
      userName: a.fullName ?? "",
      birthPlace: a.birthPlace ?? null,
      birthDate: a.birthDate ?? null,
      courseId: ses.courseId ?? null,
      courseTitle: ses.courseTitle ?? "",
      serialNo,
      issuedAt: now,
      durationHours: ses.durationHours ?? null,
      trainingStartedAt: ses.startDate ?? null,
      trainingCompletedAt: ses.endDate ?? null,
      heldIn: ses.location ?? "ONLINE",
      // Sınıf eğitiminde imza hanesi EĞİTMENİN. Bu alan yazılmadığı için
      // sınıf sertifikaları da "Online Training" olarak çıkıyordu.
      instructorName: ses.instructorName ?? null,
      organisationName: org.organisationName ?? "BONAIR AVIATION MAINTENANCE ORGANISATION",
      approvalNo: org.approvalNo ?? "TR.145.118",
      examRequired: false,
      examScore: null,
      examPassingScore: null,
      deliveryMode: "CLASSROOM",
      verifyToken,
    });

    await db.doc(`certVerify/${verifyToken}`).set({
      serialNo,
      name: a.fullName ?? "",
      courseTitle: ses.courseTitle ?? "",
      issuedAt: now,
    });

    await d.ref.update({ certificateNo: serialNo });

    // Personelse aynı kursun açık atamasını kapat.
    if (a.userId && ses.courseId) {
      const aRef = db.doc(`assignments/${a.userId}_${ses.courseId}`);
      const aSnap = await aRef.get();
      const cur = aSnap.data() as any;
      if (aSnap.exists && cur?.status !== "COMPLETED" && cur?.status !== "EXAM_PASSED") {
        await aRef.update({
          status: "COMPLETED",
          completedAt: now,
          completedVia: "CLASSROOM",
          classSessionId: sessionId,
        });
      }
    }
    results.push({ attendeeId: d.id, serialNo });
  }

  await sRef.update({
    status: "CLOSED",
    closedAt: now,
    closedById: req.auth.uid,
    certFirstNo: serials[0] ?? null,
    certLastNo: serials.at(-1) ?? null,
    issuedCount: results.length,
  });

  return { issued: results.length, first: results[0]?.serialNo, last: results.at(-1)?.serialNo };
});

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
  swf: "application/x-shockwave-flash",
};

function typeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return TYPES[ext] || "application/octet-stream";
}

/**
 * SCORM / bölüm içeriklerini aynı-origin, DİZİN YAPISI korunarak servis eder.
 * iframe içinde SCORM'un `res/index.html` → `./style.css` gibi göreli yolları
 * doğru çözülsün diye gerekli. URL: /serveScormContent/content/<...>/index.html
 * Eğitim materyali olduğu için şimdilik public (yol içindeki rastgele id ile
 * korunuyor); ileride auth eklenebilir.
 */
export const serveScormContent = onRequest(
  {
    region: "europe-west3",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    let p = decodeURIComponent(req.path || "");
    /**
     * Öncesindeki fonksiyon adı / rewrite prefixinden bağımsız: content/ ile
     * başlat. Ayraçlı aranır ("/content/"), çünkü rewrite yolu
     * "/scorm-content/content/..." biçiminde geliyor ve ayraçsız arama
     * "scorm-content/" içindeki parçaya denk gelip yolu "content/content/..."
     * yapıyordu — dosya hiçbir zaman bulunamıyordu.
     */
    const idx = p.indexOf("/content/");
    if (idx >= 0) p = p.slice(idx + 1);
    else if (!p.startsWith("content/")) {
      res.status(400).send("path required (content/...)");
      return;
    }
    // güvenlik: yalnızca content/ altını servis et, .. engelle
    if (p.includes("..")) {
      res.status(403).send("forbidden");
      return;
    }
    try {
      const file = getStorage().bucket().file(p);
      const [exists] = await file.exists();
      if (!exists) {
        res.status(404).send("not found: " + p);
        return;
      }
      res.set("Content-Type", typeFor(p));
      res.set("Cache-Control", "public, max-age=3600");
      res.set("Access-Control-Allow-Origin", "*");
      file
        .createReadStream()
        .on("error", () => {
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
    } catch (e) {
      res.status(500).send("error: " + (e as Error).message);
    }
  }
);

/**
 * Admin geçersiz kılma: bölüm içeriği açılmadığı için kilitli kalan atamayı
 * elle tamamlar. Personel eğitimi almış olabilir ama dosya yüklenmediği için
 * "I completed this section" butonu açılmıyorsa tek çıkış yolu budur.
 *
 * Sınav bütünlüğü korunur: sınavı olan ve henüz geçilmemiş bir kurs bu yolla
 * kapatılamaz — admin sınav sonucu uyduramaz.
 *
 * Denetim izi zorunlu: kim, ne zaman, hangi gerekçeyle kapattı hem atamaya
 * hem sertifikaya yazılır.
 */
export const forceCompleteAssignment = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");

  const assignmentId = String(req.data?.assignmentId || "");
  const reason = String(req.data?.reason || "").trim();
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  if (reason.length < 5)
    throw new HttpsError("invalid-argument", "A reason is required (at least 5 characters).");

  const ref = db.doc(`assignments/${assignmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const a = snap.data() as any;
  if (a.status === "COMPLETED" || a.status === "EXAM_PASSED")
    return { closed: false, reason: "already-complete" };

  const course = (await db.doc(`courses/${a.courseId}`).get()).data() || {};
  const examRequired = course.exam?.required !== false;
  if (examRequired) {
    const attempts = await db
      .collection(`assignments/${assignmentId}/examAttempts`)
      .where("passed", "==", true)
      .limit(1)
      .get();
    if (attempts.empty)
      throw new HttpsError(
        "failed-precondition",
        "Bu kursun sınavı var ve henüz geçilmemiş. Sınav sonucu elle kapatılamaz — " +
          "personel sınavı almalı."
      );
  }

  const override = {
    completedVia: "ADMIN_OVERRIDE",
    overrideReason: reason.slice(0, 500),
    overrideById: req.auth.uid,
    overrideByName: caller?.name || "",
    overrideAt: FieldValue.serverTimestamp(),
  };
  await ref.update({
    status: "COMPLETED",
    completedAt: FieldValue.serverTimestamp(),
    startedAt: a.startedAt ?? FieldValue.serverTimestamp(),
    ...override,
  });

  const fresh = (await ref.get()).data() as any;
  await issueCertificateFor(assignmentId, fresh, {
    required: examRequired,
    score: null,
    passingScore: course.exam?.passingScore ?? null,
  });
  // Sertifikada da izi bırak — denetçi belgeden geriye gidebilsin.
  await db.doc(`certificates/${assignmentId}`).set(
    { issuedVia: "ADMIN_OVERRIDE", overrideReason: override.overrideReason },
    { merge: true }
  );
  return { closed: true };
});

/**
 * Admin, herhangi bir kullanıcının şifresini sıfırlar.
 * Yeni şifre geçici sayılır: `mustChangePassword` işaretlenir, kullanıcı ilk
 * girişte kendi şifresini belirlemek zorunda kalır — böylece adminin verdiği
 * şifre kalıcı olmaz.
 *
 * Kim, kime, ne zaman sıfırladı kullanıcı kaydına yazılır.
 */
export const setUserPassword = onCall({ region: "europe-west3" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");

  const uid = String(req.data?.uid || "");
  const password = String(req.data?.password || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (password.length < 6)
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");

  const target = await db.doc(`users/${uid}`).get();
  if (!target.exists) throw new HttpsError("not-found", "User not found.");

  try {
    await getAuth().updateUser(uid, { password });
  } catch (e) {
    throw new HttpsError("internal", "Could not change the password: " + (e as Error).message);
  }

  await db.doc(`users/${uid}`).update({
    mustChangePassword: true,
    passwordResetAt: FieldValue.serverTimestamp(),
    passwordResetById: req.auth.uid,
    passwordResetByName: caller?.name || "",
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, email: target.data()?.email ?? null };
});

/**
 * Geçmiş sertifikaların içe aktarımı.
 *
 * Kâğıt/Excel sicildeki kayıtlar sisteme girilir ki numaralandırma oradan
 * devam etsin ve Training Follow-Up geçmişi görsün. `certificates` koleksiyonu
 * client'a kapalı olduğu için buradan yazılır.
 *
 * Eşleştirme: personel önce e-posta, yoksa tam ad ile; eğitim kurs adıyla.
 * Eşleşmeyen satır YİNE de sicile yazılır (sicil eksiksiz olmalı) ama
 * `userId`/`courseId` boş kalır ve sonuçta ayrıca raporlanır — o satırlar
 * kimsenin eğitim açığını kapatmaz.
 */
export const importCertificates = onCall({ region: "europe-west3" }, async (req) => {
  await assertAdmin(req.auth?.uid);
  const db = getFirestore();

  const rows: any[] = Array.isArray(req.data?.rows) ? req.data.rows : [];
  if (rows.length === 0) throw new HttpsError("invalid-argument", "No rows.");
  if (rows.length > 500)
    throw new HttpsError("invalid-argument", "At most 500 rows at a time.");

  const org = (await db.doc("orgSettings/singleton").get()).data() || {};
  const norm = (s: unknown) => String(s ?? "").trim().toLocaleLowerCase("tr");
  const [usersSnap, coursesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("courses").get(),
  ]);
  const byEmail = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const d of usersSnap.docs) {
    const u = { id: d.id, ...(d.data() as any) };
    if (u.email) byEmail.set(norm(u.email), u);
    if (u.name) byName.set(norm(u.name), u);
  }
  const courseByTitle = new Map<string, any>();
  for (const d of coursesSnap.docs) {
    const c = { id: d.id, ...(d.data() as any) };
    if (c.title) courseByTitle.set(norm(c.title), c);
  }

  const ts = (iso: unknown) => {
    const s = String(iso ?? "").trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
  };

  const results: { serialNo: string; ok: boolean; user: boolean; course: boolean; error?: string }[] =
    [];
  let maxNo = 0;

  for (const r of rows) {
    const serialNo = String(r.serialNo ?? "").trim();
    if (!serialNo) {
      results.push({ serialNo: "", ok: false, user: false, course: false, error: "No number" });
      continue;
    }
    const user = r.email ? byEmail.get(norm(r.email)) : byName.get(norm(r.name));
    const course = courseByTitle.get(norm(r.courseTitle));
    const issued = ts(r.issuedAt) ?? ts(r.completedAt);
    if (!issued) {
      results.push({ serialNo, ok: false, user: !!user, course: !!course, error: "No date" });
      continue;
    }

    // Numara belge kimliği: aynı dosya iki kez yüklenirse kayıt çiftlenmez.
    const certId = `imported_${serialNo.replace(/[^\w-]+/g, "_")}`;
    // Aynı dosya iki kez yüklenirse doğrulama anahtarı değişmesin.
    const existingToken = (await db.doc(`certificates/${certId}`).get()).data()?.verifyToken;
    const verifyToken = String(existingToken || newVerifyToken());
    try {
      await db.doc(`certificates/${certId}`).set(
        {
          serialNo,
          imported: true,
          issuedVia: "IMPORT",
          importedById: req.auth!.uid,
          importedAt: FieldValue.serverTimestamp(),
          userId: user?.id ?? null,
          userName: user?.name ?? String(r.name ?? "").trim(),
          userDepartmentId: user?.departmentId ?? null,
          courseId: course?.id ?? null,
          courseTitle: course?.title ?? String(r.courseTitle ?? "").trim(),
          birthPlace: r.birthPlace ? String(r.birthPlace).trim() : user?.birthPlace ?? null,
          birthDate: r.birthDate ? String(r.birthDate).trim() : user?.birthDate ?? null,
          instructorName: r.instructorName ? String(r.instructorName).trim() : null,
          durationHours: r.durationHours != null ? Number(r.durationHours) : null,
          trainingStartedAt: ts(r.startedAt),
          trainingCompletedAt: ts(r.completedAt),
          issuedAt: issued,
          examRequired: false,
          examScore: null,
          heldIn: r.location ? String(r.location).trim() : null,
          verifyToken,
        },
        { merge: true }
      );
      // QR doğrulama geçmiş sertifikalarda da çalışsın.
      await db.doc(`certVerify/${verifyToken}`).set(
        {
          serialNo,
          name: user?.name ?? String(r.name ?? "").trim(),
          courseTitle: course?.title ?? String(r.courseTitle ?? "").trim(),
          issuedAt: issued,
          certificateId: certId,
        },
        { merge: true }
      );
      // Sayaç YALNIZCA içinde bulunulan yılın serisini takip eder. Geçmiş
      // yıllardan (25-…) kayıt aktarmak bu yılın numarasını ileri atmamalı.
      const m = serialNo.match(/^(\d{2})\s*-\s*(\d+)\s*$/);
      if (m && m[1] === serialYear()) {
        const n = Number(m[2]);
        if (n > maxNo) maxNo = n;
      }
      results.push({ serialNo, ok: true, user: !!user, course: !!course });
    } catch (e) {
      results.push({
        serialNo,
        ok: false,
        user: !!user,
        course: !!course,
        error: (e as Error).message,
      });
    }
  }

  // Sayaç en büyük içe aktarılan numaranın bir fazlasına çekilir — yeni
  // sertifikalar sicilin devamından başlasın. Sayaç zaten ileridiyse dokunma.
  let nextNo: number | null = null;
  if (maxNo > 0) {
    const ref = db.doc("counters/certificates");
    nextNo = await db.runTransaction(async (tx) => {
      const d = (await tx.get(ref)).data() as any;
      const cur = Number(d?.next ?? 0);
      const want = maxNo + 1;
      if (want > cur) {
        tx.set(ref, { year: serialYear(), prefix: serialYear(), next: want }, { merge: true });
        return want;
      }
      return cur;
    });
  }

  return {
    total: rows.length,
    imported: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    unmatchedUser: results.filter((r) => r.ok && !r.user).map((r) => r.serialNo),
    unmatchedCourse: results.filter((r) => r.ok && !r.course).map((r) => r.serialNo),
    nextNo,
  };
});

/**
 * İçe aktarılmış sertifikaları geri alır — yanlış/eksik bir dosya yüklendiğinde
 * temiz sayfa açmak için. YALNIZCA `imported: true` kayıtlar silinir; sistemin
 * kendi ürettiği (online tamamlama, sınıf eğitimi) sertifikalara dokunulmaz.
 *
 * `dryRun` ile önce ne silineceği raporlanır. Silme geri alınamaz.
 */
export const undoCertificateImport = onCall({ region: "europe-west3" }, async (req) => {
  await assertAdmin(req.auth?.uid);
  const db = getFirestore();
  const dryRun = req.data?.dryRun !== false;
  /** Sayacı da başa al — içe aktarım onu ileri sarmıştı. */
  const resetNextTo = Number(req.data?.resetNextTo) || null;

  const snap = await db.collection("certificates").where("imported", "==", true).get();
  const serials = snap.docs.map((d) => String((d.data() as any).serialNo ?? "")).filter(Boolean);
  if (dryRun) return { wouldDelete: snap.size, serials: serials.slice(0, 10) };

  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 200) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + 200)) {
      batch.delete(d.ref);
      const t = String((d.data() as any).verifyToken ?? "");
      if (t) batch.delete(db.doc(`certVerify/${t}`));
      deleted++;
    }
    await batch.commit();
  }

  if (resetNextTo) {
    await db.doc("counters/certificates").set({ next: resetNextTo }, { merge: true });
  }
  return { deleted, nextNo: resetNextTo };
});

// ── Tek şifre devri (SSO) ─────────────────────────────────────────
// Uygulama Merkezi (bonair-launcher) üzerinden BonAir Technic şifresiyle
// giriş yapan kullanıcı, burada hesabı varsa şifre sorulmadan giriyor.
//
// onCall değil onRequest ve App Check zorlanmıyor: bu ucu launcher (başka
// bir origin) ve henüz giriş yapmamış bir sekme çağırıyor, ikisinde de bu
// projenin App Check token'ı yok. Kapı, BonAir Technic'in imzalı ID
// token'ı ve tek kullanımlık bilet. Ayrıntı: src/sso.js
export const sso = onRequest(
  { region: "europe-west3", timeoutSeconds: 30, maxInstances: 20 },
  makeSsoHandler({
    appId: "academy",
    idpProjectId: "bonappetit-c2db2",
    // Bilet İSTEYEBİLEN adresler. İki istemci var: Uygulama Merkezi ve
    // BonAir Technic portalı (ana sayfadaki Academy kartı). Mobil uygulama
    // bu listede YOK — Origin başlığı göndermiyor, sso.js onu ayrıca
    // ele alıyor.
    launcherOrigins: [
      "https://bonair-launcher.web.app",
      "https://bonair-launcher.firebaseapp.com",
      "https://portal.bonair.com.tr",
      "https://bonappetit-c2db2.web.app",
      "https://bonappetit-c2db2.firebaseapp.com",
    ],
    // Bileti KULLANABİLEN adresler — bu uygulamanın kendi adresleri.
    // Yeni bir alan adı bağlanırsa buraya eklenmeli.
    appOrigins: [
      "https://academy.bonair.com.tr",
      "https://bonair-academy.web.app",
      "https://bonair-academy.firebaseapp.com",
    ],
    // HERKESE AÇIK: BonAcademy'de hesabı olan herkes girebilir, kişiye özel
    // yetki aranmaz. Ayrı bir yetki listesi tutmak, "hesabı var ama yetkisi
    // verilmemiş" gibi çalışmayan bir ara durum üretirdi.
    requireEntitlement: false,
    // Tek kapı bu: Auth hesabı VE users/{uid} profili. Profili olmayan
    // kullanıcı uygulamada zaten hiçbir şey göremiyor.
    requireProfile: { collection: "users" },
  })
);
