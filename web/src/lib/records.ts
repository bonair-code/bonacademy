/**
 * Eğitim kaydı okuma kuralları — tek kaynak.
 *
 * Dört ekran (Dashboard/compliance, Training Follow-Up, kişi kaydı, Sertifikalarım)
 * "bu kişi bu eğitimi aldı mı, ne zamana kadar geçerli" sorusunu kendi kodunda
 * cevaplıyordu. `TrainingMatrix` içindeki yorum bunun sonucunu kayda geçmiş:
 * üç ekran aynı kişi için farklı sonuç veriyordu. Kural buraya taşındı;
 * ekranlar yalnızca kendi göstereceği alanları (sertifika no, eğitmen, dosya
 * linki) kendi tutuyor.
 */

/** Map anahtarı. Biçim üç ekranda elle yazılıyordu. */
export const keyOf = (userId: string, courseId: string) => `${userId}|${courseId}`;

export const DAY = 86400000;

/** Kursun tekrar süresine göre bitiş tarihi. `NONE`/boş → süresiz. */
export function addValidity(base: Date, every?: number | null, unit?: string): Date | null {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

export const fmt = (d?: Date | null) => (d ? d.toLocaleDateString("tr-TR") : "—");

/** Kalan gün. Bitişi olmayan kayıtta `null` — "süresiz", "dolmuş" değil. */
export const daysLeft = (expiry?: Date | null) =>
  expiry ? Math.round((expiry.getTime() - Date.now()) / DAY) : null;

/**
 * Bir (kişi, kurs) için kazanan kayıt: EN SON tamamlanan. İç sertifika ve dış
 * eğitim birlikte yarışır. Eskiden bazı ekranlarda döngüde en son gelen
 * kazanıyordu, yani sonuç rastgeleydi.
 */
export function pickLatest<T extends { date: Date }>(
  map: Map<string, T>,
  key: string,
  candidate: T | null
) {
  if (!candidate) return;
  const prev = map.get(key);
  if (!prev || candidate.date > prev.date) map.set(key, candidate);
}

/**
 * Geçerlilik bitişi. İç sertifikada kursun tekrar süresinden hesaplanır; dış
 * kayıtta belgenin KENDİ bitiş tarihi geçerlidir — sağlayıcının verdiği süre
 * bizim periyodumuzla aynı olmak zorunda değil.
 */
export function expiryOf(
  done: { date: Date; external: boolean; externalExpiry?: Date | null },
  course: { recurrenceEvery?: number | null; recurrenceUnit?: string }
): Date | null {
  if (done.external) return done.externalExpiry ?? null;
  return addValidity(done.date, course.recurrenceEvery, course.recurrenceUnit);
}

/**
 * Bir atamanın BU DÖNGÜSÜNÜN sertifika kimliği.
 *
 * Atama dokümanı yenilemede tekrar kullanılıyor (id `{userId}_{courseId}`),
 * sertifika ise her döngüde ayrı: ilk döngü atama kimliğini kullanıyor,
 * sonrakiler `_c2`, `_c3` ekliyor. Böylece eski belge üzerine yazılmıyor.
 *
 * functions/src/index.ts içindeki `certIdFor` ile AYNI kural — ikisi
 * ayrışırsa kişiye yanlış sertifika gösterilir. Tam olarak bu oldu: ekran
 * hep ilk döngünün belgesini okuyordu.
 */
export function certIdForCycle(assignmentId: string, cycle?: number | null) {
  const c = Number(cycle) || 1;
  return c > 1 ? `${assignmentId}_c${c}` : assignmentId;
}

/** Tamamlanmış sayılan atama durumları. */
export const isAssignmentDone = (status?: string | null) =>
  status === "COMPLETED" || status === "EXAM_PASSED";

/** Geri alınmış atama: ne bekliyor ne tamamlandı, hiç olmamış gibi davranılır. */
export const isAssignmentCancelled = (status?: string | null) => status === "CANCELLED";

/**
 * Hâlâ kişiden bir şey bekleyen atama. Geri alınan atama matriste "PLAN"
 * görünmeye devam ederse yanlış bilgi olur.
 */
export const isAssignmentOpen = (status?: string | null) =>
  !isAssignmentDone(status) && !isAssignmentCancelled(status);

/**
 * Açık (tamamlanmamış) atamaların `userId|courseId` kümesi — matriste "PLAN"
 * hücresi, kişi kaydında "Planned" durumu buradan geliyor.
 */
export function openAssignmentSet(
  assignments: { userId?: string; courseId?: string; status?: string }[]
): Set<string> {
  const s = new Set<string>();
  for (const a of assignments) {
    if (!isAssignmentOpen(a.status)) continue;
    if (a.userId && a.courseId) s.add(keyOf(a.userId, a.courseId));
  }
  return s;
}

export type MethodRecordRow = {
  method?: string | null;
  date: Date;
  expiry: Date | null;
  url?: string | null;
};

/**
 * (kişi, kurs) → o kursun BÜTÜN dış kayıtları. Metod bazlı eğitimde (NDT)
 * her metod ayrı bir belge; "en son kayıt" yaklaşımı PT geçerli/MT dolmuş
 * bir kişiyi uyumlu gösteriyordu.
 */
export function methodRecordIndex(
  externals: {
    userId?: string;
    courseId?: string | null;
    method?: string | null;
    completedAt?: { toDate?: () => Date } | null;
    expiresAt?: { toDate?: () => Date } | null;
    fileUrl?: string | null;
  }[]
): Map<string, MethodRecordRow[]> {
  const m = new Map<string, MethodRecordRow[]>();
  for (const e of externals) {
    const date = e.completedAt?.toDate?.();
    if (!date || !e.userId || !e.courseId) continue;
    const k = keyOf(e.userId, e.courseId);
    m.set(k, [
      ...(m.get(k) ?? []),
      {
        method: e.method ?? null,
        date,
        expiry: e.expiresAt?.toDate?.() ?? null,
        url: e.fileUrl ?? null,
      },
    ]);
  }
  return m;
}

/* ────────────────────────────────────────────────────────────────────────
   EŞDEĞERLİK — bir eğitimin yerine başka eğitim(ler)in geçmesi
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Kursun eşdeğerlik tanımı: "bu gereklilik şu kurslarla da karşılanır".
 *
 *  ALL → listedeki kursların HEPSİ gerekli. Kapsama, bunların EN ERKEN
 *        bitenine kadar sürer (biri düşerse kapsama biter).
 *  ANY → herhangi biri yeter. Kapsama, EN GEÇ bitene kadar sürer.
 *
 * Bon Air kuralı: "Safety Training = SMS + HF". Yani
 *   Safety → ALL [SMS, HF]   (ikisi de varsa Safety gerekmez; biri bitince gerekir)
 *   HF     → ANY [Safety]    (Safety alan HF'i de almış sayılır)
 *   SMS    → ANY [Safety]
 */
export type SatisfiedBy = { mode: "ALL" | "ANY"; courseIds: string[] };

/** Gerekliliği karşılayan tek bir kayıt. */
export type CoverageSource = { courseId: string; date: Date; expiry: Date | null };

/** Gereklilik nasıl karşılanıyor? `via` null ise kursun KENDİ kaydıyla. */
export type Coverage = { date: Date; expiry: Date | null; via: CoverageSource[] | null };

type DoneLike = { date: Date; external?: string | null; expiresAt?: Date | null };
type CourseLike = {
  id: string;
  recurrenceEvery?: number | null;
  recurrenceUnit?: string;
  satisfiedBy?: SatisfiedBy | null;
};

/** Süresiz (null) her zaman daha uzundur. */
const laterExpiry = (a: Date | null, b: Date | null) =>
  a === null || b === null ? null : a > b ? a : b;

/** Süresiz (null) karşı tarafı belirler — "en erken biten" aranıyor. */
const earlierExpiry = (a: Date | null, b: Date | null) =>
  a === null ? b : b === null ? a : a < b ? a : b;

/** Daha uzun koruyan kapsama kazanır; süresiz olan her şeyi yener. */
function betterCoverage(a: Coverage | null, b: Coverage | null): Coverage | null {
  if (!a) return b;
  if (!b) return a;
  if (a.expiry === null) return a;
  if (b.expiry === null) return b;
  return a.expiry >= b.expiry ? a : b;
}

/**
 * Bir (kişi, kurs) gerekliliğinin nasıl karşılandığı — doğrudan kendi kaydıyla
 * ya da eşdeğer kurslarla. İkisi de varsa **daha uzun koruyan** seçilir.
 *
 * Eşdeğerlik TEK KADEME bakar: yerine geçen kursun kendi `satisfiedBy`'ına
 * inilmez. Bu bilinçli — Safety↔HF/SMS gibi karşılıklı tanımlarda sonsuz
 * döngüyü engeller ve "A, B'nin yerine geçer" zincirinin farkında olmadan
 * uzamasını önler.
 */
export function resolveCoverage(
  userId: string,
  course: CourseLike,
  completions: Map<string, DoneLike>,
  courseById: Map<string, CourseLike>
): Coverage | null {
  const expiryFor = (d: DoneLike, c: CourseLike) =>
    expiryOf(
      { date: d.date, external: !!d.external, externalExpiry: d.expiresAt ?? null },
      c
    );

  const direct = completions.get(keyOf(userId, course.id));
  let best: Coverage | null = direct
    ? { date: direct.date, expiry: expiryFor(direct, course), via: null }
    : null;

  const sb = course.satisfiedBy;
  if (sb?.courseIds?.length) {
    const parts: CoverageSource[] = [];
    for (const cid of sb.courseIds) {
      const d = completions.get(keyOf(userId, cid));
      const sub = courseById.get(cid);
      if (d && sub) parts.push({ courseId: cid, date: d.date, expiry: expiryFor(d, sub) });
    }
    const enough = sb.mode === "ALL" ? parts.length === sb.courseIds.length : parts.length > 0;
    if (enough) {
      let expiry = parts[0].expiry;
      for (const p of parts.slice(1))
        expiry = sb.mode === "ALL" ? earlierExpiry(expiry, p.expiry) : laterExpiry(expiry, p.expiry);
      const date = parts.reduce((acc, p) => (p.date > acc ? p.date : acc), parts[0].date);
      best = betterCoverage(best, { date, expiry, via: parts });
    }
  }
  return best;
}

/* ───────────────────────── KONU (subject) ─────────────────────────
 *
 * Takip ettiğimiz şey kurs değil KONU: "bu kişinin EWIS eğitimi var mı?"
 * İlk eğitim (initial) de devamlılık eğitimi de aynı gerekliliği karşılar,
 * ama ayrı kurslardır — içerikleri, süreleri ve sınavları farklı olabilir.
 * O yüzden kurslar ayrı durur, ikisi de aynı konu etiketini taşır ve
 * matriste TEK sütun olurlar.
 *
 * Neden `satisfiedBy` ile yapılmadı: bir kursun tek bir `satisfiedBy`'ı
 * var ve "Safety Training (Include HF)" onu zaten ALL[HF, SMS] için
 * kullanıyor. Safety'ye devamlılık eğitimi eklendiği an o eşdeğerlik
 * kaybolurdu. Konu ayrı bir katman; eşdeğerlikle yan yana çalışır.
 */

/**
 * Kursun konu etiketi: "ben şu eğitimin bir çeşidiyim".
 *
 * `courseId` takip edilen eğitimin kimliği — Settings'te kapsamın gerekli
 * eğitimi olarak girilen kurs. Ad değil kimlik tutuluyor: iki kursa aynı
 * adı elle yazmak, yazım farkıyla konuyu ikiye bölerdi.
 *
 * `kind` kursun konu içindeki rolü: ilk eğitim mi, devamlılık eğitimi mi.
 * Görüntüde bir şey değiştirmez; hiçbir kaydı olmayan kişiye eğitim
 * atanırken DEVAMLILIK eğitiminin seçilmemesi için gerekli.
 */
export type SubjectTag = {
  courseId: string;
  kind?: "INITIAL" | "CONTINUATION" | null;
};

export type SubjectLike = { id: string; title: string; subject?: SubjectTag | null };

/** Konu ve onu karşılayan kurslar. `primary` işlem yapılacak varsayılan kurs. */
export type Subject<T> = { key: string; name: string; members: T[]; primary: T };

/**
 * Konunun anahtarı: takip edilen eğitimin kimliği. Etiketi olmayan kurs
 * kendi başına bir konudur — kendi kimliği anahtar olur. Bu sayede takip
 * edilen eğitim ile çeşitleri KENDİLİĞİNDEN aynı gruba düşer: "SHT-145"
 * kursunun anahtarı kendi kimliği, "SHT-145 Initial" de onu işaret eder.
 */
export const subjectKeyOf = (c: SubjectLike) => c.subject?.courseId?.trim() || c.id;


/**
 * Kursları konuya göre grupla. Sıra korunur: konu, ilk üyesinin listedeki
 * yerinde çıkar — matris sütun sırası değişmesin diye.
 *
 * Konunun ADI ve kimliği, takip edilen eğitimin (anahtarın işaret ettiği
 * kursun) kendisinden gelir. O kurs listede yoksa — süzülmüş ya da
 * silinmişse — ilk üye devralır, böylece sütun kaybolmaz.
 */
export function groupSubjects<T extends SubjectLike>(courses: T[]): Subject<T>[] {
  const out: Subject<T>[] = [];
  const byKey = new Map<string, Subject<T>>();
  for (const c of courses) {
    const key = subjectKeyOf(c);
    const found = byKey.get(key);
    if (found) {
      found.members.push(c);
      continue;
    }
    const s: Subject<T> = { key, name: c.title, members: [c], primary: c };
    byKey.set(key, s);
    out.push(s);
  }
  for (const s of out) {
    // Konunun sahibi: anahtarın işaret ettiği kurs — Settings'te gerekli
    // eğitim olarak girilen kurs. Sütunun adı ve kimliği ondan gelir.
    const owner = s.members.find((m) => m.id === s.key);
    if (owner) {
      s.name = owner.title;
      s.primary = owner;
    }
    // Atama varsayılanı ilk eğitim: hiçbir kaydı olmayan kişiye devamlılık
    // eğitimi atamak yanlış olurdu. Takip edilen eğitimin kendisinde genelde
    // içerik yok, o yüzden sahip varsayılan olarak kalmıyor.
    const initial = s.members.find((m) => m.subject?.kind === "INITIAL");
    if (initial) s.primary = initial;
  }
  return out;
}

/**
 * Konunun kapsaması: üyelerin her birini KENDİ kuralıyla çözer (kendi tekrar
 * süresi, kendi eşdeğerliği) ve en uzun koruyanı seçer. Hangi kursun kaydının
 * kazandığı `courseId` ile döner — hücre o kaydın belgesini gösterebilsin.
 *
 * Tek üyeli konuda sonuç resolveCoverage ile birebir aynıdır; konu katmanı
 * eklenince matris çıktısının değişmediği bununla doğrulandı.
 */
export function resolveSubjectCoverage<T extends CourseLike>(
  userId: string,
  members: T[],
  completions: Map<string, DoneLike>,
  courseById: Map<string, CourseLike>
): (Coverage & { courseId: string }) | null {
  let best: (Coverage & { courseId: string }) | null = null;
  for (const m of members) {
    const cov = resolveCoverage(userId, m, completions, courseById);
    if (!cov) continue;
    const tagged = { ...cov, courseId: m.id };
    best = betterCoverage(best, tagged) as (Coverage & { courseId: string }) | null;
  }
  return best;
}
