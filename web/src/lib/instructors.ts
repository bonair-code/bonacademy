/**
 * Eğitmen yetkisi — "bu kişi bu konuyu ÖĞRETEBİLİR mi?"
 *
 * Eğitim kaydından (kişi bu eğitimi aldı mı) tamamen ayrı bir şey: biri
 * uygunluk, diğeri öğretme yetkisi. Kâğıtta ayrı bir tabloydu —
 * eğitmen × konu, artı kişi başına tek bir yetki bitiş tarihi.
 *
 * Veri kullanıcıda duruyor:
 *   users.instructorFor        → öğretebileceği kursların kimlikleri
 *   users.instructorAuthExpiry → yetkinin bitiş tarihi (Timestamp | null)
 *
 * Bitiş tarihi KİŞİ BAŞINA tektir, konu başına değil — kâğıttaki tablo da
 * öyle. Boşsa süresiz sayılır.
 */

export type InstructorAuth = {
  instructorFor?: string[] | null;
  instructorAuthExpiry?: { toDate?: () => Date } | null;
  /** Tek rol — eski kayıtlar için. Asıl kaynak `roles`. */
  role?: string | null;
  roles?: string[] | null;
};

/** Yetki bitiş tarihi — yoksa null (süresiz). */
import { rolesOf } from "./roles";

/* Rol listesi tek yerden: lib/roles.ts. */

export function authExpiryOf(u: InstructorAuth): Date | null {
  return u.instructorAuthExpiry?.toDate?.() ?? null;
}

/** Yetki bugün geçerli mi? Tarihi olmayan yetki süresizdir. */
export function authValid(u: InstructorAuth, now = new Date()): boolean {
  const e = authExpiryOf(u);
  return e === null || e.getTime() >= now.getTime();
}

/**
 * Bu kişi bu kursu öğretebilir mi?
 *
 * ADMIN her zaman yapabilir: yetkilendirmeyi zaten o veriyor ve sistemin
 * kilitlenmemesi gerekiyor (tek eğitmenin yetkisi dolarsa kimse sınıf
 * açamaz hale gelmemeli).
 */
export function canTeach(
  u: InstructorAuth | null | undefined,
  courseId: string | null | undefined,
  now = new Date()
): boolean {
  if (!u) return false;
  // Bir kişi hem admin hem eğitmen olabilir; yetki rollerin TOPLAMI.
  const roles = rolesOf(u);
  if (roles.includes("ADMIN")) return true;
  if (!roles.includes("INSTRUCTOR")) return false;
  if (!courseId) return true; // kursa bağlı olmayan ("Other") oturum
  return !!u.instructorFor?.includes(courseId) && authValid(u, now);
}

/** Yetkinin bitişine kaç gün kaldı; süresizse null. */
export function authDaysLeft(u: InstructorAuth, now = new Date()): number | null {
  const e = authExpiryOf(u);
  return e === null ? null : Math.round((e.getTime() - now.getTime()) / 86400000);
}
