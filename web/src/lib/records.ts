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

/** Tamamlanmış sayılan atama durumları. */
export const isAssignmentDone = (status?: string | null) =>
  status === "COMPLETED" || status === "EXAM_PASSED";

/**
 * Açık (tamamlanmamış) atamaların `userId|courseId` kümesi — matriste "PLAN"
 * hücresi, kişi kaydında "Planned" durumu buradan geliyor.
 */
export function openAssignmentSet(
  assignments: { userId?: string; courseId?: string; status?: string }[]
): Set<string> {
  const s = new Set<string>();
  for (const a of assignments) {
    if (isAssignmentDone(a.status)) continue;
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
