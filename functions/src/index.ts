import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { SMTP_PASSWORD, sendMail, inviteMail, assignmentMail, reminderMail, tempPasswordMail, mailLang, appUrl, type AssignedItem, type MailResult } from "./mail";

// firebase-admin v14 ad-alanlı API'yi kaldırdı (admin.firestore() vb.); modüler
// giriş noktaları kullanılıyor.
initializeApp();

/* Tüm uçlar tarayıcıdan çağrılıyor; kimlik ve yetki kontrolü her fonksiyonun
 * İÇİNDE yapılıyor (req.auth + users/{uid}.role), bu yüzden Cloud Run kapısı
 * herkese açık: invoker "public". Açıkça yazılıyor çünkü fonksiyon ilk
 * oluşturulurken başarısız olup sonra güncellenirse deploy bu izni
 * kendiliğinden vermiyor ve tarayıcı 403/CORS hatası alıyor (CAPELLA
 * kurulumunda yaşandı). */
const REGION = "europe-west3";

/**
 * İngilizce klavyeyle büyük "I" ile yazılınca Türkçe kural onu noktasız ı
 * sayıyor ("Istanbul" → "Istanbul", sertifikada "ıstanbul" bile çıktı).
 * Noktalı İ ile başlayan yaygın yer adları düzeltilir; anahtar ı → i
 * çevrilerek aranır. (Isparta, Iğdır noktasız — listede yok.)
 */
const DOTTED_I: Record<string, string> = {
  istanbul: "İstanbul",
  izmir: "İzmir",
  izmit: "İzmit",
  iskenderun: "İskenderun",
};

/**
 * Yer adı biçimi: her kelimenin ilk harfi büyük, gerisi küçük (Türkçe harf
 * kurallarıyla). Doğum yeri sertifikaya basılıyor; istemcideki
 * web/src/lib/text.ts → placeCase ile aynı kural.
 */
function placeCase(s: unknown): string {
  return String(s ?? "")
    .trim()
    // \s — eskiden "s" yazılmıştı: yer adındaki her "s" boşluğa dönüyordu
    .replace(/\s+/g, " ")
    .split(/([ -])/)
    .map((w) => {
      if (w === " " || w === "-") return w;
      const low = w.toLocaleLowerCase("tr");
      return DOTTED_I[low.replace(/ı/g, "i")] ?? low.charAt(0).toLocaleUpperCase("tr") + low.slice(1);
    })
    .join("");
}

// CUSTOMER: dışarıdan eğitim alan müşteri. Personel değil — yetki kapsamı
// taşımaz, kurum uyum raporlarına girmez, yalnızca kendi eğitimine erişir.
const ROLES = ["ADMIN", "MANAGER", "INSTRUCTOR", "USER", "CUSTOMER"];

/**
 * Admin, yeni bir kullanıcı (Auth hesabı + users/{uid} profili) oluşturur.
 * Client'tan Auth kullanıcısı yaratılamaz; admin SDK gerekir.
 */
export const createUser = onCall({ region: REGION, invoker: "public", secrets: [SMTP_PASSWORD] }, async (req) => {
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
  const birthPlace = d.birthPlace ? placeCase(d.birthPlace) || null : null;
  const birthDate = d.birthDate ? String(d.birthDate).trim() : null; // YYYY-MM-DD
  // Müşteri hangi kuruma bağlı — "X şirketinin aldığı eğitimler" raporu için.
  const company = d.company ? String(d.company).trim() : null;
  // Metod bazlı eğitimlerde kişinin yetkili olduğu metodlar: { courseId: ["PT","MT"] }
  const courseMethods = sanitizeCourseMethods(d.courseMethods);
  // Davet: kişi şifresini e-postadaki bağlantıyla kendisi belirler; buradaki
  // rastgele şifre kimsenin bilmediği bir yer tutucu.
  const invite = d.invite === true;
  const password = !invite && d.password ? String(d.password) : randomBytes(9).toString("base64") + "Aa1!";
  if (password.length < 8) throw new HttpsError("invalid-argument", "Password must be at least 8 characters.");

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
    // Admin geçici şifre verdiyse kullanıcı ilk girişte değiştirmek zorunda.
    // Davette şifreyi zaten kendisi belirliyor.
    mustChangePassword: !invite,
    isActive: true,
    locale: "tr",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const inviteResult = invite ? await sendInviteFor(userRecord.uid, req.auth.uid) : null;
  return { uid: userRecord.uid, invite: inviteResult };
});

/* ── Davet (şifre belirleme) ──────────────────────────────────
 * Yeni kullanıcıya ortak bir şifre vermek yerine "şifreni belirle" bağlantısı
 * gönderilir. Bağlantı kendi belirtecimizle (invites/{token}) çalışır:
 * Firebase'in hazır şifre sıfırlama bağlantısı 1 saatte doluyor, davet için
 * kısa. Belirteç tek kullanımlık, 14 gün geçerli; yeniden gönderilince
 * öncekiler iptal olur. Koleksiyon istemciye tamamen kapalı (kural yok).
 */
const INVITE_DAYS = 14;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function sendInviteFor(uid: string, byUid: string): Promise<MailResult> {
  const db = getFirestore();
  const u = (await db.doc(`users/${uid}`).get()).data();
  if (!u?.email) return { ok: false, error: "User has no email address." };

  const open = await db.collection("invites").where("uid", "==", uid).where("status", "==", "OPEN").get();
  if (!open.empty) {
    const b = db.batch();
    for (const d of open.docs) b.update(d.ref, { status: "REVOKED", revokedAt: FieldValue.serverTimestamp() });
    await b.commit();
  }
  const token = randomBytes(24).toString("base64url");
  await db.doc(`invites/${token}`).set({
    uid,
    email: u.email,
    status: "OPEN",
    createdAt: FieldValue.serverTimestamp(),
    createdById: byUid,
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 24 * 3600 * 1000),
  });
  const mail = inviteMail(mailLang(u.locale), {
    name: u.name || u.email,
    email: u.email,
    link: `${appUrl()}/invite/${token}`,
    days: INVITE_DAYS,
  });
  const res = await sendMail({ to: u.email, ...mail, type: "INVITE", userId: uid });
  await db.doc(`users/${uid}`).update({
    invitedAt: FieldValue.serverTimestamp(),
    inviteEmailStatus: res.ok ? "SENT" : "FAILED",
  });
  return res;
}

/** Admin: daveti (yeniden) gönderir. Önceki bağlantılar geçersiz olur. */
export const resendInvite = onCall(
  { region: REGION, invoker: "public", secrets: [SMTP_PASSWORD] },
  async (req) => {
    await assertAdmin(req.auth?.uid);
    const uid = String(req.data?.uid || "");
    if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
    const res = await sendInviteFor(uid, req.auth!.uid);
    if (!res.ok) throw new HttpsError("unavailable", "The invitation email could not be sent: " + res.error);
    return { ok: true };
  }
);

/** Herkese açık: davet sayfası bağlantının durumunu ve kişinin adını sorar. */
export const inviteInfo = onCall({ region: REGION, invoker: "public" }, async (req) => {
  const token = String(req.data?.token || "");
  if (!TOKEN_RE.test(token)) return { valid: false, reason: "invalid" };
  const db = getFirestore();
  const s = await db.doc(`invites/${token}`).get();
  if (!s.exists) return { valid: false, reason: "invalid" };
  const v = s.data() as any;
  if (v.status === "USED") return { valid: false, reason: "used" };
  if (v.status !== "OPEN") return { valid: false, reason: "replaced" };
  if (v.expiresAt?.toMillis?.() < Date.now()) return { valid: false, reason: "expired" };
  const u = (await db.doc(`users/${v.uid}`).get()).data();
  return { valid: true, name: u?.name ?? "", email: v.email };
});

/** Herkese açık: davetle şifre belirler. Başarılıysa istemci bu e-postayla giriş yapar. */
export const acceptInvite = onCall({ region: REGION, invoker: "public" }, async (req) => {
  const token = String(req.data?.token || "");
  const password = String(req.data?.password || "");
  if (!TOKEN_RE.test(token)) throw new HttpsError("not-found", "This invitation link is not valid.");
  if (password.length < 8) throw new HttpsError("invalid-argument", "The password must be at least 8 characters.");

  const db = getFirestore();
  const ref = db.doc(`invites/${token}`);
  const inv = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const v = s.data() as any;
    if (!s.exists || v.status === "REVOKED")
      throw new HttpsError("not-found", "This invitation link is not valid any more. Ask for a new one.");
    if (v.status === "USED")
      throw new HttpsError("failed-precondition", "This invitation was already used. Sign in, or use “Forgot password?”.");
    if (v.expiresAt?.toMillis?.() < Date.now())
      throw new HttpsError("deadline-exceeded", "This invitation link has expired. Ask for a new one.");
    tx.update(ref, { status: "USED", usedAt: FieldValue.serverTimestamp() });
    return v as { uid: string; email: string };
  });
  try {
    await getAuth().updateUser(inv.uid, { password, emailVerified: true });
  } catch (e) {
    // Şifre yazılamadıysa bağlantı yanmasın.
    await ref.update({ status: "OPEN", usedAt: FieldValue.delete() });
    throw new HttpsError("invalid-argument", (e as Error).message);
  }
  await db.doc(`users/${inv.uid}`).update({
    mustChangePassword: false,
    inviteAcceptedAt: FieldValue.serverTimestamp(),
  });
  return { email: inv.email };
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
  const caller = (await getFirestore().doc(`users/${uid}`).get()).data();
  // Pasifleştirilmiş admin'in elindeki oturum (≤1 saat) da işe yaramasın.
  if (caller?.role !== "ADMIN" || caller?.isActive === false)
    throw new HttpsError("permission-denied", "This action is for admins only.");
}

/**
 * Belge kimliği biçimi. Kimlik doğrudan yola konduğu için "/" içermemeli:
 * eskiden "x/scorm/f1" gibi bir kimlikle istemcinin yazabildiği bir alt
 * belge "atama" diye yüklenip herhangi bir kursun sınavına sınırsız
 * girilebiliyordu (güvenlik incelemesi, 08.10.2026). Geçersizse "".
 */
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
function cleanId(v: unknown): string {
  const s = String(v ?? "");
  return ID_RE.test(s) ? s : "";
}

/**
 * Kullanıcı profilini günceller. Rol/departman değişince custom claim'i de
 * yeniler — aksi halde token eski rolü taşımaya devam eder (Storage kuralları
 * ve arayüz claim'e bakıyor).
 */
export const updateUser = onCall({ region: REGION, invoker: "public" }, async (req) => {
  await assertAdmin(req.auth?.uid);

  const uid = String(req.data?.uid || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  const db = getFirestore();
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "User not found.");

  const d = req.data || {};
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof d.name === "string" && d.name.trim()) patch.name = d.name.trim();
  if (ROLES.includes(d.role)) patch.role = d.role;
  if (d.departmentId !== undefined) patch.departmentId = d.departmentId ? String(d.departmentId) : null;
  if (Array.isArray(d.jobTitleIds)) patch.jobTitleIds = d.jobTitleIds.map(String);
  if (Array.isArray(d.subScopeIds)) patch.subScopeIds = d.subScopeIds.map(String);
  if (d.birthPlace !== undefined) patch.birthPlace = d.birthPlace ? placeCase(d.birthPlace) || null : null;
  if (d.birthDate !== undefined) patch.birthDate = d.birthDate ? String(d.birthDate).trim() : null;
  if (d.company !== undefined) patch.company = d.company ? String(d.company).trim() : null;
  if (d.courseMethods !== undefined) patch.courseMethods = sanitizeCourseMethods(d.courseMethods);
  if (typeof d.isActive === "boolean") patch.isActive = d.isActive;

  // E-posta (giriş adresi) değişikliği: önce Auth'ta (aynı adres başka hesapta
  // varsa reddedilir), sonra profilde. Açık davetler eski adrese gitmiş
  // olabileceği için iptal edilir — gerekirse yeniden gönderilir.
  const newEmail = typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
  if (newEmail && newEmail !== String(snap.data()?.email ?? "").toLowerCase()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail) || newEmail.length > 200)
      throw new HttpsError("invalid-argument", "That does not look like a valid email address.");
    try {
      await getAuth().updateUser(uid, { email: newEmail, emailVerified: false });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      throw new HttpsError(
        code.includes("email-already-exists") ? "already-exists" : "invalid-argument",
        code.includes("email-already-exists")
          ? "Another account already uses that email address."
          : "Could not change the email: " + (e as Error).message
      );
    }
    patch.email = newEmail;
    const open = await db.collection("invites").where("uid", "==", uid).where("status", "==", "OPEN").get();
    for (const inv of open.docs) await inv.ref.update({ status: "REVOKED", revokedAt: FieldValue.serverTimestamp() });
  }

  const oldDept = snap.data()?.departmentId ?? null;
  const old = snap.data() || {};
  await snap.ref.update(patch);

  /**
   * Kimlik bilgisi düzeltilince (yazım hatası: "Berkan" → "Berkay",
   * "Istanbul" → "İstanbul") sertifikalar da düzeltilir. Sertifika verildiği
   * anki bilgileri dondurur, ama yanlış yazılmış bir ad dondurulacak bir bilgi
   * değil, hatadır: belge ve QR doğrulama sayfası doğrusunu göstermeli.
   */
  const certFix: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name !== old.name) certFix.userName = patch.name;
  if (patch.birthPlace !== undefined && patch.birthPlace !== (old.birthPlace ?? null))
    certFix.birthPlace = patch.birthPlace;
  if (patch.birthDate !== undefined && patch.birthDate !== (old.birthDate ?? null))
    certFix.birthDate = patch.birthDate;
  if (Object.keys(certFix).length) {
    const certs = await db.collection("certificates").where("userId", "==", uid).get();
    for (let i = 0; i < certs.docs.length; i += 200) {
      const batch = db.batch();
      for (const c of certs.docs.slice(i, i + 200)) {
        batch.update(c.ref, certFix);
        const token = c.data().verifyToken;
        if (token && certFix.userName)
          batch.set(db.doc(`certVerify/${token}`), { name: certFix.userName }, { merge: true });
      }
      await batch.commit();
    }
  }

  /**
   * Departman değişince KAYITLAR da güncellenmeli.
   *
   * `userDepartmentId` sertifika ve dış eğitim kayıtlarında denormalize
   * tutuluyor, çünkü müdürün sorgusu bu alana göre daraltılıyor (kapsamsız
   * sorgu güvenlik kuralınca reddediliyor). Alan eskide kalırsa kişi yeni
   * departmanında görünür ama eğitim kayıtları görünmez — matris o kişiyi
   * "hiç eğitim almamış" gösterir. Bu tam olarak bir kez yaşandı.
   */
  if (patch.departmentId !== undefined && patch.departmentId !== oldDept) {
    const want = (patch.departmentId as string | null) ?? null;
    for (const col of ["certificates", "externalTrainings", "assignments"]) {
      const rows = await db.collection(col).where("userId", "==", uid).get();
      for (let i = 0; i < rows.docs.length; i += 400) {
        const batch = db.batch();
        for (const r of rows.docs.slice(i, i + 400))
          batch.update(r.ref, { userDepartmentId: want });
        await batch.commit();
      }
    }
  }

  const role = (patch.role as string) ?? snap.data()?.role ?? "USER";
  const departmentId =
    patch.departmentId !== undefined ? patch.departmentId : snap.data()?.departmentId ?? null;
  await getAuth().setCustomUserClaims(uid, { role, departmentId });

  // Pasifleştirilen kullanıcı Auth tarafında da giriş yapamasın.
  if (typeof d.isActive === "boolean") {
    await getAuth().updateUser(uid, { disabled: !d.isActive });
  }
  // Pasifleştirme ya da rol değişikliği HEMEN geçerli olsun: açık oturumlar
  // eski yetkiyle bir saate kadar çalışmaya devam ediyordu.
  if (d.isActive === false || (patch.role !== undefined && patch.role !== snap.data()?.role)) {
    await getAuth().revokeRefreshTokens(uid);
  }
  return { ok: true };
});

/**
 * Kullanıcıyı siler: Auth hesabı + users/{uid} profili. Eğitim kayıtları
 * (assignments/certificates) BİLEREK silinmez — havacılık eğitim kayıtları
 * saklanmak zorunda; kayıt silmek gerekirse ayrı ve bilinçli bir iş olmalı.
 */
export const deleteUser = onCall({ region: REGION, invoker: "public" }, async (req) => {
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
export const publishCourse = onCall({ region: REGION, invoker: "public" }, async (req) => {
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
  const isOwner = c.ownerInstructorId === req.auth.uid && caller?.role === "INSTRUCTOR";
  if ((caller?.role !== "ADMIN" && !isOwner) || caller?.isActive === false)
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

  // Kurs adı değiştiyse bitmemiş atamalardaki kopyayı da güncelle: öğrenci
  // panelinde ve atama listesinde eski ad kalmasın. Biten atamalara dokunulmaz
  // — onlar o günkü adla verilmiş bir kaydın parçası.
  const title = String(c.title ?? "").trim();
  if (title) {
    const stale = await db.collection("assignments").where("courseId", "==", courseId).get();
    const batch = db.batch();
    let n = 0;
    for (const d of stale.docs) {
      const x = d.data() as any;
      if (x.courseTitle === title || x.status === "COMPLETED" || x.status === "CANCELLED") continue;
      batch.update(d.ref, { courseTitle: title });
      n++;
    }
    if (n) await batch.commit();
  }

  return { revisionNo, active: true };
});

/**
 * Bir personele eğitim(ler) atar. Atama durum geçişleri güvenlik gereği
 * yalnızca Function tarafından yazılır. Deterministik id ({userId}_{courseId})
 * → aynı eğitim ikinci kez atanmaz (idempotent).
 */
export const assignCourses = onCall({ region: REGION, invoker: "public", secrets: [SMTP_PASSWORD] }, async (req) => {
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

  // Son tarih yalnızca istenirse konur (CAPELLA kararı, 08.10.2026). Eskiden
  // her atamaya kendiliğinden "bugün + 30 gün" yazılıyordu.
  const dueDate = parseDue(req.data);

  let created = 0;
  const skipped: { courseId: string; reason: string }[] = [];
  // E-posta bildirimi için: bu çağrıda açılan atamalar (tek mailde toplanır).
  const notifyItems: (AssignedItem & { assignmentId: string })[] = [];
  const noteItem = (assignmentId: string, course: any) =>
    notifyItems.push({
      assignmentId,
      title: String(course.title || ""),
      dueDate: dueDate ? dueDate.toDate() : null,
      examRequired: course.exam?.required !== false,
    });
  for (const courseId of courseIds) {
    const courseSnap = await db.doc(`courses/${courseId}`).get();
    if (!courseSnap.exists) {
      skipped.push({ courseId, reason: "Course not found." });
      continue;
    }
    const course = courseSnap.data() as any;
    if (callerRole === "INSTRUCTOR" && course.ownerInstructorId !== req.auth.uid) {
      skipped.push({ courseId, reason: "Not your course." });
      continue;
    }

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
    const existing = await ref.get();
    if (existing.exists) {
      const prev = existing.data() as any;
      const st = prev?.status;
      const finished = st === "COMPLETED" || st === "EXAM_PASSED";

      // Tamamlanmış eğitimi tekrar atamak meşru bir istek: yenileme dönemi.
      // Engellemek yerine YENİ BİR DÖNGÜ açılıyor — ilerleme sıfırlanıyor,
      // önceki sertifika yerinde kalıyor (certIdFor döngüyü taşıyor).
      if (finished) {
        await clearExamSessions(id);
        await ref.update({
          status: "PENDING",
          cycleNumber: (Number(prev.cycleNumber) || 1) + 1,
          sectionsDone: [],
          examAttemptCount: 0,
          dueDate,
          startedAt: FieldValue.delete(),
          completedAt: FieldValue.delete(),
          completedVia: FieldValue.delete(),
          triggeredBy: "MANAGER_REQUESTED",
          triggeredById: req.auth.uid,
          reassignedAt: FieldValue.serverTimestamp(),
        });
        created++;
        noteItem(id, course);
        continue;
      }

      // Hâlâ açık olan atamada yapacak bir şey yok.
      skipped.push({ courseId, reason: "Already assigned and still open." });
      continue;
    }
    // Bitirilmiş atama kaldırılmış olabilir (cancelAssignment, sertifika
    // durur). Atama kimliği aynı olduğundan döngü 1'den başlarsa yeni
    // sertifikanın kimliği eskisiyle çakışır ve hiç verilmez — döngü eski
    // sertifikaların üstünden devam eder.
    const pastCerts = await db.collection("certificates").where("assignmentId", "==", id).get();
    const lastCycle = pastCerts.docs.reduce((m, d) => Math.max(m, Number(d.data().cycleNumber) || 1), 0);
    await ref.set({
      userId,
      userDepartmentId,
      courseId,
      courseTitle: course.title || "",
      status: "PENDING",
      cycleNumber: lastCycle + 1,
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
    noteItem(id, course);
  }

  // Atama bildirimi: kişiye tek e-posta. Gönderilemezse atama yine geçerli.
  let mail: MailResult | null = null;
  if (notifyItems.length && req.data?.notify !== false) {
    const u = userSnap.data() || {};
    if (u.email && u.isActive !== false) {
      const link =
        notifyItems.length === 1 ? `${appUrl()}/learn/${notifyItems[0].assignmentId}` : `${appUrl()}/dashboard`;
      const m = assignmentMail(mailLang(u.locale), { name: u.name || u.email, items: notifyItems, link });
      mail = await sendMail({
        to: u.email,
        ...m,
        type: "ASSIGNMENT",
        userId,
        meta: { assignmentIds: notifyItems.map((x) => x.assignmentId) },
      });
    }
  }
  // `skipped` geri dönüyor: arayüz "20 kişiye atadım" deyip 12'sini sessizce
  // atlamasın, sebebini gösterebilsin.
  return { created, skipped, mail };
});


/**
 * Hatırlatma e-postası: atanmış ama bitmemiş eğitim için kişiye elle
 * gönderilir (Assign Training → ⋮ → Send reminder). Son tarih ve ilerleme
 * (kaç bölüm bitti) mailde yazar. Ne zaman ve kaç kez hatırlatıldığı atamada
 * tutulur; liste "Reminded …" diye gösterir.
 */
export const sendAssignmentReminder = onCall(
  { region: REGION, invoker: "public", secrets: [SMTP_PASSWORD] },
  async (req) => {
    await assertCanManageAssignments(req.auth?.uid);
    const assignmentId = cleanId(req.data?.assignmentId);
    if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
    await assertOwnsAssignmentCourse(req.auth!.uid, assignmentId);
    const db = getFirestore();
    const ref = db.doc(`assignments/${assignmentId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
    const a = snap.data() as any;
    if (a.status === "COMPLETED" || a.status === "EXAM_PASSED")
      throw new HttpsError("failed-precondition", "This training is already completed.");
    if (a.status === "CANCELLED") throw new HttpsError("failed-precondition", "This assignment was withdrawn.");
    if (a.accessBlocked)
      throw new HttpsError("failed-precondition", "Access to this training is blocked — restore access first.");

    const u = (await db.doc(`users/${a.userId}`).get()).data();
    if (!u?.email) throw new HttpsError("failed-precondition", "This person has no email address.");
    if (u.isActive === false) throw new HttpsError("failed-precondition", "This person's account is inactive.");

    const total = (await courseSections(a.courseId, asLang(a.contentLanguage))).length;
    const done = Array.isArray(a.sectionsDone) ? a.sectionsDone.length : 0;
    const m = reminderMail(mailLang(u.locale), {
      name: u.name || u.email,
      title: String(a.courseTitle || ""),
      dueDate: a.dueDate?.toDate?.() ?? null,
      done: Math.min(done, total),
      total,
      started: done > 0 || a.status !== "PENDING",
      link: `${appUrl()}/learn/${assignmentId}`,
    });
    const res = await sendMail({
      to: u.email,
      ...m,
      type: "REMINDER",
      userId: a.userId,
      meta: { assignmentId, sentById: req.auth!.uid },
    });
    if (!res.ok) throw new HttpsError("unavailable", "The reminder could not be sent: " + res.error);
    await ref.update({
      lastReminderAt: FieldValue.serverTimestamp(),
      reminderCount: FieldValue.increment(1),
    });
    return { ok: true };
  }
);

/**
 * Son tarih: "YYYY-MM-DD" (dueDate, o günün sonu, Türkiye saati) ya da gün
 * sayısı (dueDays). İkisi de yoksa son tarih YOK (null).
 */
function parseDue(d: any): Timestamp | null {
  const iso = typeof d?.dueDate === "string" ? d.dueDate.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    // 23:59:59 Türkiye (UTC+3, yaz saati yok) = 20:59:59 UTC
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], 20, 59, 59);
    if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
  }
  const days = Number(d?.dueDays);
  if (d?.dueDays != null && Number.isFinite(days) && days > 0)
    return Timestamp.fromMillis(Date.now() + Math.min(Math.round(days), 730) * 24 * 3600 * 1000);
  return null;
}

/**
 * İlk giriş: kişi ad-soyadını düzeltir, doğum yeri ve tarihini girer.
 *
 * Adı yönetici yazıyor ve bazen yanlış oluyor (CAPELLA isteği: kişinin kendi
 * yazdığı esas alınsın). Ad yalnızca BU ilk adımda değişebilir —
 * profileCompletedAt yazıldıktan sonra kişi kendi adını oynatamaz (sertifikaya
 * basılan bir kimlik bilgisi); sonrası yöneticinin işi (updateUser).
 * Güvenlik kuralı kişinin `name` alanına yazmasına izin vermiyor, bu yüzden
 * sunucuda.
 */
export const completeProfile = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = req.auth.uid;
  const db = getFirestore();
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
  const u = snap.data() as any;

  // Profil bir kez tamamlandı mı, kişi artık ad/doğum bilgisini değiştiremez
  // (sertifikaya basılan kimlik bilgileri) — sonrası yöneticide (updateUser).
  if (u.profileCompletedAt)
    throw new HttpsError("permission-denied", "Your details are already saved. Please ask an administrator to change them.");

  const birthPlace = placeCase(req.data?.birthPlace);
  const birthDate = String(req.data?.birthDate || "").trim();
  if (!birthPlace) throw new HttpsError("invalid-argument", "Place of birth is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new HttpsError("invalid-argument", "Date of birth is required.");

  const patch: Record<string, unknown> = {
    birthPlace,
    birthDate,
    profileCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const rawName = String(req.data?.name ?? "").replace(/\s+/g, " ").trim();
  if (rawName && rawName !== u.name) {
    if (u.profileCompletedAt)
      throw new HttpsError("permission-denied", "Your name can only be changed by an administrator.");
    if (rawName.length < 3 || rawName.length > 80 || !rawName.includes(" "))
      throw new HttpsError("invalid-argument", "Please enter your full name (first and last name).");
    patch.name = rawName;
    patch.nameSetBySelfAt = FieldValue.serverTimestamp();
  }
  await ref.update(patch);

  if (patch.name) {
    await getAuth().updateUser(uid, { displayName: rawName }).catch(() => undefined);
    // İlk girişten önce verilmiş sertifika olabilir (sınıf/ içe aktarım).
    const certs = await db.collection("certificates").where("userId", "==", uid).get();
    if (!certs.empty) {
      const b = db.batch();
      for (const c of certs.docs) {
        b.update(c.ref, { userName: rawName });
        const token = c.data().verifyToken;
        if (token) b.set(db.doc(`certVerify/${token}`), { name: rawName }, { merge: true });
      }
      await b.commit();
    }
  }
  return { ok: true };
});

/**
 * İlk girişte geçici şifreyi kişinin kendi şifresiyle değiştirir.
 *
 * "Şifre değiştirmeli" işareti istemciden kapatılamaz: eskiden kural kişiye
 * mustChangePassword alanını yazdırıyordu, kişi şifreyi hiç değiştirmeden
 * işareti kapatıp yöneticinin (e-postayla gönderilen) geçici şifresini kalıcı
 * yapabiliyordu. Artık şifre ve işaret birlikte, sunucuda değişir. Şifre Admin
 * SDK ile yazıldığı için oturum yenilenir — istemci yeni şifreyle tekrar girer.
 */
export const changeTempPassword = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = req.auth.uid;
  const password = String(req.data?.password || "");
  if (password.length < 8) throw new HttpsError("invalid-argument", "The password must be at least 8 characters.");
  const ref = getFirestore().doc(`users/${uid}`);
  const u = (await ref.get()).data();
  if (!u) throw new HttpsError("not-found", "Profile not found.");
  if (u.mustChangePassword !== true)
    throw new HttpsError("failed-precondition", "There is no temporary password to change.");
  await getAuth().updateUser(uid, { password });
  await ref.update({
    mustChangePassword: false,
    passwordChangedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, email: u.email ?? null };
});

/** Atamanın son tarihini değiştirir ya da kaldırır (dueDate: null). */
export const setAssignmentDueDate = onCall({ region: REGION, invoker: "public" }, async (req) => {
  await assertCanManageAssignments(req.auth?.uid);
  const assignmentId = cleanId(req.data?.assignmentId);
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  await assertOwnsAssignmentCourse(req.auth!.uid, assignmentId);
  const ref = getFirestore().doc(`assignments/${assignmentId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Assignment not found.");
  const dueDate = parseDue({ dueDate: req.data?.dueDate });
  if (req.data?.dueDate && !dueDate) throw new HttpsError("invalid-argument", "Invalid date.");
  await ref.update({ dueDate });
  return { ok: true, dueDate: dueDate ? dueDate.toMillis() : null };
});

/** Atamanın sınav oturumlarını siler — yeni döngüde eski oturum kullanılamasın. */
async function clearExamSessions(assignmentId: string) {
  const snap = await getFirestore().collection(`assignments/${assignmentId}/examSessions`).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = getFirestore().batch();
    for (const d of snap.docs.slice(i, i + 400)) b.delete(d.ref);
    await b.commit();
  }
}

/**
 * Eğitmen yalnızca KENDİ kursunun atamalarını yönetir; admin hepsini
 * (CAPELLA kararı, 09.10.2026). Atama yoksa sessiz geçer — sonraki kontrol
 * "bulunamadı" der.
 */
async function assertOwnsAssignmentCourse(uid: string, assignmentId: string) {
  const db = getFirestore();
  const role = (await db.doc(`users/${uid}`).get()).data()?.role;
  if (role === "ADMIN") return;
  const a = (await db.doc(`assignments/${assignmentId}`).get()).data();
  if (!a) return;
  const c = (await db.doc(`courses/${a.courseId}`).get()).data();
  if (c?.ownerInstructorId !== uid)
    throw new HttpsError("permission-denied", "You can only manage assignments of your own courses.");
}

/** Atama işlemleri admin ve eğitmenin: eğitimi veren yönetir. */
async function assertCanManageAssignments(uid?: string) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const caller = (await getFirestore().doc(`users/${uid}`).get()).data();
  const r = caller?.isActive === false ? null : caller?.role;
  if (r !== "ADMIN" && r !== "INSTRUCTOR")
    throw new HttpsError("permission-denied", "This action is for admins and instructors.");
  return r as string;
}

/**
 * Atamayı sıfırlar: kişi eğitimi baştan alır.
 *
 * Atama dokümanı silinmiyor, YENİ BİR DÖNGÜYE alınıyor (`cycleNumber` artar).
 * Böylece daha önce verilmiş sertifika yerinde kalıyor — yeni tamamlama ayrı
 * kimlikli ayrı bir belge üretiyor (bkz. certIdFor). Havacılık kaydında
 * geçmiş belge silinmez.
 *
 * Tamamlanmış bir eğitimi tekrar atamak da buradan geçiyor: "zaten atanmış"
 * diye engellemek yerine, istenirse yeni döngü açılıyor.
 */
export const resetAssignment = onCall({ region: REGION, invoker: "public" }, async (req) => {
  await assertCanManageAssignments(req.auth?.uid);
  const assignmentId = cleanId(req.data?.assignmentId);
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  await assertOwnsAssignmentCourse(req.auth!.uid, assignmentId);
  const reason = String(req.data?.reason ?? "").trim();

  const db = getFirestore();
  const ref = db.doc(`assignments/${assignmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const a = snap.data() as any;

  const cycle = (Number(a.cycleNumber) || 1) + 1;

  await clearExamSessions(assignmentId);
  await ref.update({
    status: "PENDING",
    cycleNumber: cycle,
    sectionsDone: [],
    examAttemptCount: 0,
    dueDate: parseDue(req.data),
    startedAt: FieldValue.delete(),
    completedAt: FieldValue.delete(),
    completedVia: FieldValue.delete(),
    resetAt: FieldValue.serverTimestamp(),
    resetById: req.auth!.uid,
    resetReason: reason || null,
  });
  return { ok: true, cycleNumber: cycle };
});

/**
 * Atamayı geri alır — doküman silinir.
 *
 * Tamamlanmamış bir atama bir KAYIT değil, bir görevdir: yanlış atandıysa
 * ortadan kalkmalı, yoksa matriste "PLAN" olarak durup yanlış bilgi verir.
 * Yarım bırakılmış ilerleme de bir uygunluk kaydı üretmiyor.
 *
 * Tamamlanmış eğitim silinemez: sertifika verildi, belge kaydın parçası.
 * Tekrar aldırmak gerekiyorsa resetAssignment kullanılır.
 */
/**
 * Bir atamaya erişimi engeller ya da geri verir. Bitmiş eğitimde de çalışır.
 *
 * Engelliyken kişi eğitimi açamaz, ilerleyemez, sınava giremez
 * (loadOwnedAssignment) ve o atamanın sertifikası "My Certificates"ten
 * kalkar: sertifikada blocked = true olur, kişinin okuma kuralı yalnızca
 * blocked == false belgelere izin veriyor. Kayıt silinmez — yönetici her şeyi
 * görmeye devam eder, erişim geri verilince her şey eski hâline döner. QR
 * doğrulama sayfası etkilenmez (belge geçerli; kısıtlanan platform erişimi).
 */
export const setAssignmentAccess = onCall({ region: REGION, invoker: "public" }, async (req) => {
  await assertCanManageAssignments(req.auth?.uid);
  const assignmentId = cleanId(req.data?.assignmentId);
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  await assertOwnsAssignmentCourse(req.auth!.uid, assignmentId);
  const blocked = req.data?.blocked === true;
  const reason = String(req.data?.reason ?? "").trim().slice(0, 500);

  const db = getFirestore();
  const ref = db.doc(`assignments/${assignmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");

  await ref.update(
    blocked
      ? {
          accessBlocked: true,
          accessBlockedAt: FieldValue.serverTimestamp(),
          accessBlockedById: req.auth!.uid,
          accessBlockReason: reason || null,
        }
      : {
          accessBlocked: false,
          accessBlockedAt: null,
          accessBlockedById: null,
          accessBlockReason: null,
        }
  );
  const certs = await db.collection("certificates").where("assignmentId", "==", assignmentId).get();
  if (!certs.empty) {
    const batch = db.batch();
    for (const c of certs.docs) batch.update(c.ref, { blocked });
    await batch.commit();
  }
  return { ok: true, blocked, certificates: certs.size };
});

export const cancelAssignment = onCall({ region: REGION, invoker: "public" }, async (req) => {
  await assertCanManageAssignments(req.auth?.uid);
  const assignmentId = cleanId(req.data?.assignmentId);
  if (!assignmentId) throw new HttpsError("invalid-argument", "assignmentId is required.");
  await assertOwnsAssignmentCourse(req.auth!.uid, assignmentId);
  const reason = String(req.data?.reason ?? "").trim();

  const db = getFirestore();
  const ref = db.doc(`assignments/${assignmentId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const a = snap.data() as any;

  // Bitmiş eğitim de kaldırılabilir: kişi eğitim içeriğine erişemez, ama
  // SERTİFİKA DOKUNULMADAN kalır (My Certificates, sicil, QR doğrulama).
  // Takip ekranı geçerliliği sertifikadan okuduğu için etkilenmez.

  // Silmeden önce iz bırak: kim, ne zaman, neden kaldırdı.
  await db.collection("assignmentRemovals").add({
    assignmentId,
    userId: a.userId ?? null,
    userDepartmentId: a.userDepartmentId ?? null,
    courseId: a.courseId ?? null,
    courseTitle: a.courseTitle ?? null,
    statusAtRemoval: a.status ?? null,
    sectionsDoneCount: Array.isArray(a.sectionsDone) ? a.sectionsDone.length : 0,
    removedAt: FieldValue.serverTimestamp(),
    removedById: req.auth!.uid,
    reason: reason || null,
  });
  await clearExamSessions(assignmentId);
  await ref.delete();
  return { ok: true, deleted: true };
});

/**
 * Dışarıdan alınan eğitim, aynı kursun açık atamasını kapatır — kişi o eğitimi
 * zaten aldıysa sistemde tekrar yapmasına gerek yok.
 *
 * Kurum sertifikası ÜRETİLMEZ: eğitimi biz vermedik, elimizde onların belgesi
 * var. Durum COMPLETED ama completedVia = EXTERNAL olarak işaretlenir.
 */
export const closeAssignmentExternally = onCall({ region: REGION, invoker: "public" }, async (req) => {
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

  if (!ID_RE.test(userId) || !ID_RE.test(courseId) || (externalTrainingId && !ID_RE.test(externalTrainingId)))
    throw new HttpsError("invalid-argument", "Invalid id.");
  // Müdür yalnızca kendi departmanındaki personel için. Departmansız müdür
  // hiç kimse için (null == null eşleşmesi bütün müşterileri açıyordu).
  const target = (await db.doc(`users/${userId}`).get()).data();
  if (role === "MANAGER" && (!caller?.departmentId || target?.departmentId !== caller.departmentId))
    throw new HttpsError("permission-denied", "That person is not in your department.");
  // Kanıt: dış eğitim kaydı bu kişiye ve bu eğitime ait olmalı (müdür için şart).
  if (role === "MANAGER" && !externalTrainingId)
    throw new HttpsError("invalid-argument", "An external training record is required.");
  if (externalTrainingId) {
    const ext = (await db.doc(`externalTrainings/${externalTrainingId}`).get()).data();
    if (!ext || ext.userId !== userId || (ext.courseId && ext.courseId !== courseId))
      throw new HttpsError("failed-precondition", "The external training record does not match.");
  }

  const ref = db.doc(`assignments/${userId}_${courseId}`);
  const snap = await ref.get();
  if (!snap.exists) return { closed: false, reason: "no-assignment" };

  const a = snap.data() as any;
  if (a.status === "COMPLETED" || a.status === "EXAM_PASSED")
    return { closed: false, reason: "already-complete" };
  if (a.status === "CANCELLED" || a.accessBlocked) return { closed: false, reason: "not-open" };

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
  if (!ID_RE.test(assignmentId)) throw new HttpsError("invalid-argument", "Invalid assignment.");
  const db = getFirestore();
  const snap = await db.doc(`assignments/${assignmentId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Assignment not found.");
  const a = snap.data() as any;
  if (a.userId !== uid) throw new HttpsError("permission-denied", "This assignment is not yours.");
  if (a.accessBlocked)
    throw new HttpsError(
      "permission-denied",
      "Your access to this training has been suspended. Please contact info@capella.aero."
    );
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
/** Sayaç belgesinden sıradaki numaralar + sayacın yeni hali (işlem içinde kullanılır). */
function allocSerials(d: any, count: number) {
  const year = serialYear();
  const pad = Number(d?.pad) || 3;
  // Yıl değiştiyse seri sıfırlanır; aynı yıl içinde kaldığı yerden sürer.
  // Eski sayaç yalnızca `value` tutuyordu; ilk geçişte ondan devam et.
  const sameYear = String(d?.year ?? "") === year;
  const start = sameYear ? Number(d?.next ?? (d?.value ?? 0) + 1) || 1 : 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`${year}-${String(start + i).padStart(pad, "0")}`);
  return { serials: out, counter: { year, prefix: year, pad, next: start + count } };
}

async function nextSerialNo(count = 1): Promise<string[]> {
  const db = getFirestore();
  const ref = db.doc("counters/certificates");
  return db.runTransaction(async (tx) => {
    const { serials, counter } = allocSerials((await tx.get(ref)).data(), count);
    tx.set(ref, counter, { merge: true });
    return serials;
  });
}

/**
 * Bir atamanın BU DÖNGÜSÜNÜN sertifika kimliği.
 *
 * Atama dokümanı tekrar kullanılıyor (id `{userId}_{courseId}`), dolayısıyla
 * eğitim yenilenince sertifika da aynı kimliğe yazılsaydı önceki belge
 * ÜZERİNE yazılırdı. Havacılık kaydında eski sertifika kaybolamaz.
 *
 * İlk döngü eski kimliği koruyor ki var olan 247 sertifika yerinde kalsın.
 */
function certIdFor(assignmentId: string, cycle: number) {
  return cycle > 1 ? `${assignmentId}_c${cycle}` : assignmentId;
}

async function issueCertificateFor(assignmentId: string, a: any, exam?: ExamInfo) {
  const db = getFirestore();
  const cycle = Number(a.cycleNumber) || 1;
  const certRef = db.doc(`certificates/${certIdFor(assignmentId, cycle)}`);
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
  // Ad KURSTAN okunur: atamadaki courseTitle atama anında kopyalanıyor ve kurs
  // sonradan yeniden adlandırılırsa eski adı taşıyordu (sertifikaya eski ad
  // basılıyordu). Belge verildiği anki adla dondurulur.
  const courseTitle = String(course.title || a.courseTitle || "");
  const org = (await db.doc("orgSettings/singleton").get()).data() || {};
  const verifyToken = newVerifyToken();
  const now = FieldValue.serverTimestamp();
  // Numara alma ve belgeyi yazma TEK işlemde: aynı anda iki tamamlama gelirse
  // ikincisi belgeyi var bulup çıkar. Eskiden iki numara harcanıyor, ikinci
  // belge birincinin üzerine yazılıyor, ilk QR kaydı sahipsiz kalıyordu.
  const counterRef = db.doc("counters/certificates");
  await db.runTransaction(async (tx) => {
    const [existing, counterSnap] = await Promise.all([tx.get(certRef), tx.get(counterRef)]);
    if (existing.exists) return;
    const { serials, counter } = allocSerials(counterSnap.data(), 1);
    const serialNo = serials[0];
    tx.set(counterRef, counter, { merge: true });
    tx.create(db.doc(`certVerify/${verifyToken}`), { serialNo, name: userName, courseTitle, issuedAt: now });
    tx.create(certRef, {
    assignmentId,
    /** Kaçıncı kez alındığı — aynı eğitimin önceki belgeleri duruyor. */
    cycleNumber: cycle,
    userId: a.userId,
    userName,
    // Müdürün kendi departmanının sertifikalarını okuyabilmesi için gerekli —
    // güvenlik kuralı bu alana bakıyor.
    userDepartmentId: a.userDepartmentId ?? null,
    courseId: a.courseId,
    courseTitle,
    serialNo,
    issuedAt: now,
    // — dondurulan alanlar —
    birthPlace: user.birthPlace ? placeCase(user.birthPlace) : null,
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
    organisationName: org.organisationName ?? "CAPELLA AVIATION SOLUTIONS",
    // CAPELLA SHT-145 onaylı değil — belgede onay numarası yok.
    approvalNo: null,
    verifyToken,
    // Kişi kendi sertifikasını yalnızca blocked == false iken okur (kural +
    // sorgu). Alan HER sertifikada olmalı: eksikse kişi belgesini göremez.
    blocked: !!a.accessBlocked,
    });
  });
}

/** Bir bölümü tamamlar (sıralı zorunluluk kontrolüyle). Hepsi bitince sınav
 *  varsa SECTIONS_DONE, yoksa COMPLETED + sertifika. */
export const completeSection = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId, sectionId } = req.data || {};
  const { ref, a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  if (a.status === "COMPLETED") return { status: "COMPLETED" };
  if (a.status === "CANCELLED")
    throw new HttpsError("failed-precondition", "This assignment has been withdrawn.");

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
/** Sınav kuralları — giriş ekranı, başlatma ve gönderim aynı değerleri kullanır. */
const EXAM_MAX_ATTEMPTS = 2; // 2. başarısızlıkta bölümler sıfırlanır (submitExam)
/**
 * Süre dolduktan sonra gönderime tanınan pay. İstemci süre bitince cevapları
 * kendisi gönderiyor; bu pay yalnızca ağ gecikmesi için. Payı aşan gönderim
 * süre dışı sayılır (bkz. finalizeAttempt).
 */
const EXAM_GRACE_MS = 60 * 1000;

/** Sınavın alınabileceği diller: sorusu olan ve yayınlanmış (ya da eğitimin dili olan). */
async function examLanguages(courseId: string, course: any, contentLang: Lang) {
  const snap = await getFirestore().collection(`courses/${courseId}/questions`).get();
  const counts: Record<Lang, number> = { TR: 0, EN: 0 };
  for (const d of snap.docs) counts[asLang((d.data() as any).lang)]++;
  const published = new Set(
    (Array.isArray(course?.publishedLangs) ? course.publishedLangs : []).map(asLang)
  );
  return (["TR", "EN"] as Lang[]).map((lang) => ({
    lang,
    questions: counts[lang],
    available: counts[lang] > 0 && (published.has(lang) || lang === contentLang),
  }));
}

function examConfig(course: any) {
  const exam = course?.exam || { questionCount: 10, shuffle: true };
  const limit = Number(exam.timeLimitMin);
  return {
    required: exam.required !== false,
    questionCount: Number(exam.questionCount) || 10,
    shuffle: exam.shuffle !== false,
    passingScore: exam.passingScore || course?.passingScore || 70,
    timeLimitMin: Number.isFinite(limit) && limit > 0 ? limit : null,
  };
}

/** Oturumdaki soruları cevapsız biçimde döndürür (sıra korunur). */
async function sessionQuestions(courseId: string, lang: Lang, ids: string[]) {
  const byId = new Map((await courseQuestions(courseId, lang)).map((q) => [q.id, q]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((q: any) => ({
      id: q.id,
      text: q.text,
      options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text })),
    }));
}

/**
 * Sınav giriş ekranının bilgileri. Sorular istemciye okunamadığı için soru
 * sayıları ve dil seçenekleri buradan geliyor. Yarım kalmış bir deneme varsa
 * kalan süresiyle birlikte bildirilir.
 */
export const examInfo = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId } = req.data || {};
  const { a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  const db = getFirestore();
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  const cfg = examConfig(course);
  const contentLang = asLang(a.contentLanguage);
  const languages = await examLanguages(a.courseId, course, contentLang);

  const attemptNo = ((a.examAttemptCount as number) || 0) + 1;
  const sess = (await db.doc(`assignments/${assignmentId}/examSessions/${attemptNo}`).get()).data() as any;
  const resume =
    sess && !sess.submittedAt
      ? {
          attemptNo,
          lang: asLang(sess.lang ?? contentLang),
          remainingSec: sess.deadlineMs ? Math.max(0, Math.round((sess.deadlineMs - Date.now()) / 1000)) : null,
        }
      : null;

  return {
    courseTitle: a.courseTitle ?? course?.title ?? "",
    questionCount: cfg.questionCount,
    timeLimitMin: cfg.timeLimitMin,
    passingScore: cfg.passingScore,
    shuffle: cfg.shuffle,
    attemptNo,
    maxAttempts: EXAM_MAX_ATTEMPTS,
    defaultLang: contentLang,
    languages,
    resume,
  };
});

export const startExam = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId, language } = req.data || {};
  const { ref, a } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  if (a.status === "CANCELLED")
    throw new HttpsError("failed-precondition", "This assignment has been withdrawn.");
  if (a.status !== "SECTIONS_DONE" && a.status !== "EXAM_FAILED")
    throw new HttpsError("failed-precondition", "Complete every section first.");

  const db = getFirestore();
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  const cfg = examConfig(course);
  if (!cfg.required) throw new HttpsError("failed-precondition", "This course has no exam.");

  const attemptNo = ((a.examAttemptCount as number) || 0) + 1;
  const sessRef = db.doc(`assignments/${assignmentId}/examSessions/${attemptNo}`);
  const existing = (await sessRef.get()).data() as any;

  /* Yarım kalan deneme KALDIĞI YERDEN sürer: aynı sorular, aynı bitiş saati.
     Eskiden her çağrı yeni rastgele soru çekiyordu — sayfayı yenileyen kişi
     hem soruları değiştirebiliyor hem de (süre olsaydı) süreyi sıfırlardı.
     Süresi geçmişse deneme süre dışı olarak kapatılır. */
  // Önceki döngüden kalmış oturum yok sayılır (yeni oturum açılır).
  const staleSession = existing && (Number(existing.cycleNumber) || 1) !== (Number(a.cycleNumber) || 1);
  if (existing && !existing.submittedAt && !staleSession) {
    const lang = asLang(existing.lang ?? a.contentLanguage);
    if (existing.deadlineMs && Date.now() > existing.deadlineMs + EXAM_GRACE_MS) {
      const claimed = await claimAttempt(ref, sessRef);
      const result = await finalizeAttempt(String(assignmentId), claimed.a, ref, sessRef, claimed.sess, {}, true);
      return { expired: true, result };
    }
    return {
      attemptNo,
      language: lang,
      passingScore: cfg.passingScore,
      timeLimitMin: existing.timeLimitMin ?? null,
      deadlineMs: existing.deadlineMs ?? null,
      serverNow: Date.now(),
      resumed: true,
      questions: await sessionQuestions(a.courseId, lang, existing.questionIds || []),
    };
  }

  // Dil öğrencinin seçimi; yalnızca sorusu olan ve açık olan diller kabul.
  const contentLang = asLang(a.contentLanguage);
  const languages = await examLanguages(a.courseId, course, contentLang);
  const wanted = language ? asLang(language) : contentLang;
  const lang = languages.find((l) => l.lang === wanted && l.available)
    ? wanted
    : contentLang;
  let qs = await courseQuestions(a.courseId, lang);
  if (qs.length === 0)
    throw new HttpsError("failed-precondition", "This language has no exam questions.");
  if (cfg.shuffle) qs = qs.sort(() => Math.random() - 0.5);
  qs = qs.slice(0, Math.min(cfg.questionCount, qs.length));

  const now = Date.now();
  const deadlineMs = cfg.timeLimitMin ? now + cfg.timeLimitMin * 60 * 1000 : null;
  await sessRef.set({
    attemptNo,
    // Hangi döngünün sınavı: sıfırlama/yenilemeden kalan eski oturum yeni
    // döngüde gönderilemesin.
    cycleNumber: Number(a.cycleNumber) || 1,
    lang,
    questionIds: qs.map((q) => q.id),
    timeLimitMin: cfg.timeLimitMin,
    startedAtMs: now,
    deadlineMs,
    createdAt: FieldValue.serverTimestamp(),
  });
  // Cevapları çıkararak döndür.
  return {
    attemptNo,
    language: lang,
    passingScore: cfg.passingScore,
    timeLimitMin: cfg.timeLimitMin,
    deadlineMs,
    serverNow: now,
    resumed: false,
    questions: qs.map((q) => ({
      id: q.id,
      text: q.text,
      options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text })),
    })),
  };
});

/**
 * Denemeyi puanlar ve kapatır. `expired`: süre (+ pay) geçtikten sonra
 * gelen ya da hiç gönderilmeden süresi dolan deneme — cevaplar SAYILMAZ,
 * puan 0. İstemci süre bitince kendisi gönderdiği için buraya normalde
 * yalnızca sınavı yarıda bırakıp süre bittikten sonra dönen kişi düşer.
 */
async function finalizeAttempt(
  assignmentId: string,
  a: any,
  ref: DocumentReference,
  sessRef: DocumentReference,
  sess: any,
  answers: Record<string, string>,
  expired: boolean
) {
  const db = getFirestore();
  const attemptNo = sess.attemptNo as number;
  const lang = asLang(sess.lang ?? a.contentLanguage);
  const allQs = await courseQuestions(a.courseId, lang);
  const byId = new Map(allQs.map((q) => [q.id, q]));
  let correct = 0;
  const picked: string[] = sess.questionIds || [];
  if (!expired) {
    for (const qid of picked) {
      const q = byId.get(qid);
      if (!q) continue;
      const correctOpt = (q.options || []).find((o: any) => o.isCorrect);
      if (correctOpt && answers[qid] === correctOpt.id) correct++;
    }
  }
  const score = picked.length ? Math.round((correct / picked.length) * 100) : 0;
  const course = (await db.doc(`courses/${a.courseId}`).get()).data() as any;
  const passingScore = examConfig(course).passingScore;
  const passed = !expired && score >= passingScore;

  await sessRef.update({ expired });
  await db.doc(`assignments/${assignmentId}/examAttempts/${attemptNo}`).set({
    // userId olmadan güvenlik kuralı (isSelf(resource.data.userId)) sahibi bile
    // reddediyordu.
    userId: a.userId,
    attemptNo,
    score,
    passed,
    lang,
    expired,
    createdAt: FieldValue.serverTimestamp(),
  });

  if (passed) {
    await ref.update({
      status: "COMPLETED",
      examAttemptCount: attemptNo,
      // Not atamada da tutulur: atama listesi her satır için sertifika ya da
      // deneme kaydı okumadan gösterebilsin.
      examScore: score,
      examPassingScore: passingScore,
      completedAt: FieldValue.serverTimestamp(),
    });
    await issueCertificateFor(assignmentId, a, { required: true, score, passingScore });
    return { passed, score, expired, status: "COMPLETED" };
  }
  // Başarısız: son hakta baştan (bölümleri sıfırla), yoksa tekrar sınav.
  if (attemptNo >= EXAM_MAX_ATTEMPTS) {
    await ref.update({
      status: "IN_PROGRESS",
      sectionsDone: [],
      examAttemptCount: attemptNo,
      lastExamScore: score,
      examPassingScore: passingScore,
    });
    return { passed, score, expired, status: "RETAKE_REQUIRED" };
  }
  await ref.update({
    status: "EXAM_FAILED",
    examAttemptCount: attemptNo,
    lastExamScore: score,
    examPassingScore: passingScore,
  });
  return { passed, score, expired, status: "EXAM_FAILED" };
}

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
export const setAssignmentLanguage = onCall({ region: REGION, invoker: "public" }, async (req) => {
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

/**
 * Denemeyi TEK SEFERLİK sahiplenir (işlem içinde): gönderilmemiş, bu döngüye
 * ait, sıradaki deneme ve atama sınav aşamasında olmalı. Eskiden kontrol ile
 * yazma arasında boşluk vardı: aynı denemeyi aynı anda farklı cevaplarla
 * birkaç kez göndermek ya da sıfırlamadan kalan eski bir oturumu sonradan
 * göndermek mümkündü (güvenlik incelemesi, 08.10.2026).
 */
async function claimAttempt(ref: DocumentReference, sessRef: DocumentReference) {
  return getFirestore().runTransaction(async (tx) => {
    const [aSnap, sSnap] = await Promise.all([tx.get(ref), tx.get(sessRef)]);
    const a = aSnap.data() as any;
    const sess = sSnap.data() as any;
    if (!a || !sess) throw new HttpsError("not-found", "No exam session found.");
    if (sess.submittedAt) throw new HttpsError("failed-precondition", "This attempt has already been submitted.");
    if (a.status !== "SECTIONS_DONE" && a.status !== "EXAM_FAILED")
      throw new HttpsError("failed-precondition", "This exam is not open.");
    if ((Number(sess.cycleNumber) || 1) !== (Number(a.cycleNumber) || 1))
      throw new HttpsError("failed-precondition", "This exam session is no longer valid.");
    if (Number(sess.attemptNo) !== (Number(a.examAttemptCount) || 0) + 1)
      throw new HttpsError("failed-precondition", "This exam session is no longer valid.");
    tx.update(sessRef, { submittedAt: FieldValue.serverTimestamp() });
    return { a, sess };
  });
}

export const submitExam = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { assignmentId, attemptNo, answers } = req.data || {};
  const n = Number(attemptNo);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new HttpsError("invalid-argument", "Invalid attempt.");
  const { ref } = await loadOwnedAssignment(req.auth.uid, String(assignmentId));
  const sessRef = getFirestore().doc(`assignments/${assignmentId}/examSessions/${n}`);
  const { a, sess } = await claimAttempt(ref, sessRef);
  if (!sess.attemptNo) sess.attemptNo = n;

  // Süre sunucu saatine göre: istemcinin sayacına güvenilmez.
  const expired = !!sess.deadlineMs && Date.now() > sess.deadlineMs + EXAM_GRACE_MS;
  const ans = answers && typeof answers === "object" ? (answers as Record<string, string>) : {};
  return finalizeAttempt(String(assignmentId), a, ref, sessRef, sess, ans, expired);
});

/**
 * Yüz yüze eğitim oturumunu kapatır ve katılımcılara sertifika üretir.
 *
 * Sertifika numarası oturumu planlarken verilen başlangıçtan sırayla dağıtılır
 * (ör. 25-131, 25-132 …) — kağıt kayıtlarının devamı getirilebilsin diye.
 * Katılımcı sistemde kayıtlıysa aynı kursun açık ataması da kapatılır.
 */
export const finishClassSession = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN" && caller?.role !== "INSTRUCTOR")
    throw new HttpsError("permission-denied", "This action is for admins and instructors.");

  const sessionId = String(req.data?.sessionId || "");
  if (!sessionId) throw new HttpsError("invalid-argument", "sessionId is required.");

  if (!ID_RE.test(sessionId)) throw new HttpsError("invalid-argument", "Invalid session.");
  const sRef = db.doc(`classSessions/${sessionId}`);
  // Kapatma TEK SEFERLİK: durum işlem içinde CLOSING'e alınır. Eskiden iki
  // eşzamanlı çağrı (çift tıklama) sertifikaları ikinci kez numaralayıp
  // sahipsiz QR kayıtları bırakıyordu.
  const ses = await db.runTransaction(async (tx) => {
    const sn = await tx.get(sRef);
    if (!sn.exists) throw new HttpsError("not-found", "Session not found.");
    const d = sn.data() as any;
    if (caller?.role === "INSTRUCTOR" && d.createdById !== req.auth!.uid)
      throw new HttpsError("permission-denied", "You can only finish your own sessions.");
    if (d.status === "CLOSED" || d.status === "CLOSING")
      throw new HttpsError("failed-precondition", "This session is already closed.");
    // Önce yoklama kapanmalı: yoklama açıkken sertifika verilmez.
    if (d.status === "OPEN")
      throw new HttpsError("failed-precondition", "Close attendance first.");
    tx.update(sRef, { status: "CLOSING", closingStartedAt: FieldValue.serverTimestamp(), statusBeforeClosing: d.status ?? null });
    return d;
  });
  const reopen = () => sRef.update({ status: ses.status ?? "OPEN" }).catch(() => undefined);

  const attSnap = await db.collection(`classSessions/${sessionId}/attendees`).orderBy("signedAt").get();
  const attendees = attSnap.docs.filter((d) => (d.data() as any).rejected !== true);
  if (attendees.length === 0) {
    await reopen();
    throw new HttpsError("failed-precondition", "No attendees — no certificate can be issued.");
  }

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
  for (const u of usersSnap.docs) {
    const x = u.data() as any;
    if (x.name) userByName.set(norm(x.name), u.id);
  }

  for (let i = 0; i < attendees.length; i++) {
    const d = attendees[i];
    const a = d.data() as any;
    const serialNo = serials[i];
    // Eşleşme yalnızca ADA göre (öğretmenin ekranda gördüğüyle aynı). Katılımcının
    // yazdığı e-posta eşleştirmede KULLANILMAZ — başkasının adresini yazan biri
    // onun atamasını kapatamasın; e-posta yalnızca sertifikayı göndermek için.
    if (!a.userId) {
      const match = userByName.get(norm(a.fullName));
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
      birthPlace: a.birthPlace ? placeCase(a.birthPlace) : null,
      birthDate: a.birthDate ?? null,
      courseId: ses.courseId ?? null,
      courseTitle: ses.courseTitle ?? "",
      serialNo,
      issuedAt: now,
      durationHours: ses.durationHours ?? null,
      trainingStartedAt: ses.startDate ?? null,
      trainingCompletedAt: ses.endDate ?? null,
      heldIn: ses.location ?? "ONLINE",
      blocked: false,
      // Sınıf eğitiminde imza hanesi EĞİTMENİN. Bu alan yazılmadığı için
      // sınıf sertifikaları da "Online Training" olarak çıkıyordu.
      instructorName: ses.instructorName ?? null,
      organisationName: org.organisationName ?? "CAPELLA AVIATION SOLUTIONS",
      // CAPELLA SHT-145 onaylı değil — belgede onay numarası yok.
      approvalNo: null,
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

// ── SCORM erişim anahtarı ───────────────────────────────────
// iframe istekleri kimlik başlığı taşımaz; bu yüzden içerik, scormAccess'in
// verdiği imzalı anahtarla açılır. Anahtar YOLUN İÇİNDE durur
// (/a/<anahtar>/content/...): paketin göreli yolları (./style.css) da onu
// kendiliğinden taşır. İmza yalnızca "kim, hangi kurs, ne zamana kadar" der;
// erişim her istekte ayrıca kontrol edilir (kısa önbellekle), böylece atama
// kaldırılınca/engellenince anahtar bir dakika içinde işe yaramaz olur.

/** Uzun bir SCORM oturumu ortasında kesilmesin diye bir iş günü. */
const SCORM_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const SCORM_ACCESS_CACHE_MS = 60 * 1000;

let scormKeyCache: Buffer | null = null;
/** İmza anahtarı ilk kullanımda üretilip saklanır; istemci kuralları bu koleksiyonu kapatıyor. */
async function scormSecret(): Promise<Buffer> {
  if (scormKeyCache) return scormKeyCache;
  const ref = getFirestore().doc("appSecrets/scormAccess");
  // create() varsa başarısız olur — aynı anda iki örnek üretse de tek anahtar kalır.
  await ref.create({ key: randomBytes(32).toString("hex"), createdAt: FieldValue.serverTimestamp() }).catch(() => {});
  const key = String((await ref.get()).data()?.key || "");
  if (!key) throw new Error("scorm secret missing");
  scormKeyCache = Buffer.from(key, "hex");
  return scormKeyCache;
}

/** Kurs içeriğini kim görebilir: ADMIN, EĞİTMEN, ya da eğitim atanmış ve engellenmemiş kişi. */
async function canReadCourseContent(uid: string, courseId: string): Promise<boolean> {
  const db = getFirestore();
  const [u, a] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`assignments/${uid}_${courseId}`).get(),
  ]);
  const role = u.data()?.role;
  if (role === "ADMIN" || role === "INSTRUCTOR") return true;
  return a.exists && a.data()?.accessBlocked !== true;
}

const accessCache = new Map<string, { ok: boolean; at: number }>();
async function canReadCached(uid: string, courseId: string): Promise<boolean> {
  const k = `${uid}|${courseId}`;
  const hit = accessCache.get(k);
  if (hit && Date.now() - hit.at < SCORM_ACCESS_CACHE_MS) return hit.ok;
  const ok = await canReadCourseContent(uid, courseId);
  if (accessCache.size > 5000) accessCache.clear();
  accessCache.set(k, { ok, at: Date.now() });
  return ok;
}

async function verifyScormToken(token: string): Promise<{ u: string; c: string } | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", await scormSecret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const x = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof x?.u !== "string" || typeof x?.c !== "string" || !(x.e > Date.now())) return null;
    return { u: x.u, c: x.c };
  } catch {
    return null;
  }
}

/** SCORM içeriğini açmak için kursa özel, süreli anahtar. */
export const scormAccess = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const courseId = String(req.data?.courseId || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(courseId))
    throw new HttpsError("invalid-argument", "courseId is required.");
  if (!(await canReadCourseContent(req.auth.uid, courseId)))
    throw new HttpsError("permission-denied", "You do not have access to this training.");
  const exp = Date.now() + SCORM_TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ u: req.auth.uid, c: courseId, e: exp })).toString("base64url");
  const sig = createHmac("sha256", await scormSecret()).update(body).digest("base64url");
  return { token: `${body}.${sig}`, exp };
});

/**
 * SCORM / bölüm içeriklerini aynı-origin, DİZİN YAPISI korunarak servis eder.
 * iframe içinde SCORM'un `res/index.html` → `./style.css` gibi göreli yolları
 * doğru çözülsün diye gerekli.
 * URL: /serveScormContent/a/<anahtar>/content/<courseId>/.../index.html
 * Anahtarsız ya da kursla eşleşmeyen istek reddedilir (bkz. scormAccess).
 */
export const serveScormContent = onRequest(
  {
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
    invoker: "public",
  },
  async (req, res) => {
    // Bu yanıtlar uygulamayla AYNI kökenden sunuluyor (/scorm-content
    // yönlendirmesi): kullanıcı girdisi asla HTML olarak geri yansımamalı.
    res.set("X-Content-Type-Options", "nosniff");
    const fail = (code: number, msg: string) => {
      res.status(code).type("text/plain").send(msg);
    };
    let p: string;
    try {
      p = decodeURIComponent(req.path || "");
    } catch {
      fail(400, "bad request");
      return;
    }
    /**
     * Öncesindeki fonksiyon adı / rewrite prefixinden bağımsız: content/ ile
     * başlat. Ayraçlı aranır ("/content/"), çünkü rewrite yolu
     * "/scorm-content/content/..." biçiminde geliyor ve ayraçsız arama
     * "scorm-content/" içindeki parçaya denk gelip yolu "content/content/..."
     * yapıyordu — dosya hiçbir zaman bulunamıyordu.
     */
    const idx = p.indexOf("/content/");
    if (idx < 0) {
      fail(400, "bad request");
      return;
    }
    // Anahtar, content/'ten hemen önceki "/a/<anahtar>" parçası.
    const token = /\/a\/([^/]+)$/.exec(p.slice(0, idx))?.[1];
    p = p.slice(idx + 1);
    // güvenlik: yalnızca content/ altını servis et, .. engelle
    if (p.includes("..") || p.includes("\\")) {
      fail(403, "forbidden");
      return;
    }
    try {
      // Yalnızca SCORM paketi: content/<kurs>/<bölüm>/scorm/<paket>/... PDF ve
      // video bu servisten geçmez; başka bir dosya (yüklenmiş tekil HTML/SVG)
      // uygulamanın kökeninde çalışacak şekilde sunulmasın.
      if (!/^content\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/scorm\/[A-Za-z0-9_-]+\//.test(p)) {
        fail(403, "forbidden");
        return;
      }
      const courseId = p.split("/")[1] || "";
      const grant = token ? await verifyScormToken(token) : null;
      if (!grant || grant.c !== courseId || !(await canReadCached(grant.u, courseId))) {
        fail(403, "forbidden");
        return;
      }
      const file = getStorage().bucket().file(p);
      const [exists] = await file.exists();
      if (!exists) {
        fail(404, "not found");
        return;
      }
      res.set("Content-Type", typeFor(p));
      // private: Hosting CDN'i saklayıp anahtarsız birine sunmasın.
      res.set("Cache-Control", "private, max-age=3600");
      // Yalnızca uygulamanın kendi sayfaları çerçeveleyebilir.
      res.set(
        "Content-Security-Policy",
        "frame-ancestors 'self' https://academy.capella.aero https://capella-academy-v2.web.app https://capella-academy-v2.firebaseapp.com"
      );
      file
        .createReadStream()
        .on("error", () => {
          if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
    } catch (e) {
      console.error("serveScormContent", (e as Error).message);
      if (!res.headersSent) fail(500, "error");
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
export const forceCompleteAssignment = onCall({ region: REGION, invoker: "public" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");

  const assignmentId = cleanId(req.data?.assignmentId);
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
  // Sertifikada da izi bırak — denetçi belgeden geriye gidebilsin. Kimlik
  // DÖNGÜYE göre seçiliyor: düz atama kimliği, yenilenmiş bir eğitimde
  // ÖNCEKİ döngünün belgesini damgalardı.
  await db.doc(`certificates/${certIdFor(assignmentId, Number(fresh.cycleNumber) || 1)}`).set(
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
export const setUserPassword = onCall({ region: REGION, invoker: "public", secrets: [SMTP_PASSWORD] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const caller = (await db.doc(`users/${req.auth.uid}`).get()).data();
  if (caller?.role !== "ADMIN")
    throw new HttpsError("permission-denied", "This action is for admins only.");

  const uid = String(req.data?.uid || "");
  const password = String(req.data?.password || "");
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (password.length < 8)
    throw new HttpsError("invalid-argument", "Password must be at least 8 characters.");

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

  // Geçici şifre kişiye e-postayla (noreply@capella.aero) gider; ilk girişte
  // kendi şifresini belirlemek zorunda (mustChangePassword yukarıda).
  const t = target.data() || {};
  let mail: MailResult | null = null;
  if (req.data?.notify !== false && t.email) {
    const m = tempPasswordMail(mailLang(t.locale), { name: t.name || t.email, email: t.email, password });
    mail = await sendMail({ to: t.email, ...m, type: "TEMP_PASSWORD", userId: uid, meta: { sentById: req.auth.uid } });
  }

  return { ok: true, email: t.email ?? null, mail };
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
export const importCertificates = onCall({ region: REGION, invoker: "public" }, async (req) => {
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
          birthPlace: r.birthPlace ? placeCase(r.birthPlace) : user?.birthPlace ? placeCase(user.birthPlace) : null,
          birthDate: r.birthDate ? String(r.birthDate).trim() : user?.birthDate ?? null,
          instructorName: r.instructorName ? String(r.instructorName).trim() : null,
          durationHours: r.durationHours != null ? Number(r.durationHours) : null,
          trainingStartedAt: ts(r.startedAt),
          trainingCompletedAt: ts(r.completedAt),
          issuedAt: issued,
          examRequired: false,
          examScore: null,
          blocked: false,
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
      // Sayaç geçen yıldan kalmışsa bu yıl için 0 sayılır (eskiden geçen
      // yılın "next"i karşılaştırılıyor, bu yılın numaraları tekrar veriliyordu).
      const cur = String(d?.year ?? "") === serialYear() ? Number(d?.next ?? 0) : 0;
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
export const undoCertificateImport = onCall({ region: REGION, invoker: "public" }, async (req) => {
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

  // Sayaç, sistemin VERDİĞİ bu yılın en büyük numarasının altına inemez —
  // aksi halde verilmiş numaralar tekrar verilir.
  let nextNo: number | null = null;
  if (resetNextTo) {
    const year = serialYear();
    const rest = await db.collection("certificates").get();
    let maxIssued = 0;
    for (const d of rest.docs) {
      const m = /^(\d{2})-(\d+)$/.exec(String((d.data() as any).serialNo ?? ""));
      if (m && m[1] === year) maxIssued = Math.max(maxIssued, Number(m[2]));
    }
    nextNo = Math.max(resetNextTo, maxIssued + 1);
    await db.doc("counters/certificates").set({ year, prefix: year, next: nextNo }, { merge: true });
  }
  return { deleted, nextNo };
});

// ── Tek şifre devri (SSO) — CAPELLA'da KAPALI ─────────────────────
// BonAcademy'de bu uç, BonAir Uygulama Merkezi'nden (BonAir Technic şifresi)
// gelen kullanıcıya oturum devrediyordu. CAPELLA ayrı bir kurum: BonAir'in
// kimlik kaynağına güvenmesi, başka bir şirketin kullanıcılarına bu sisteme
// kapı açmak olurdu. CAPELLA'nın kendi launcher'ı kurulursa src/sso.js
// olduğu gibi kullanılabilir — makeSsoHandler'a CAPELLA'nın IdP proje
// kimliği ve adresleri verilerek burada yeniden export edilir.
