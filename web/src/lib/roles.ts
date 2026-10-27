/**
 * Çoklu rol — bir kişi aynı anda birden fazla rol taşıyabilir.
 *
 * Gerçek hayatta bir kalite müdürü aynı zamanda eğitmen olabiliyor, admin
 * de eğitim veriyor. Tek `role` alanı bunu anlatamıyordu: kişiyi eğitmen
 * yapmak admin yetkisini elinden alıyordu.
 *
 * Veri:
 *   users.roles  → sahip olduğu bütün roller (asıl kaynak)
 *   users.role   → bunlardan en yetkilisi; TÜRETİLMİŞ alan, sunucu yazar.
 *                  Eski kayıtlar ve claim'i olmayan hesaplar için duruyor;
 *                  `rolesOf` ikisini de okuyabiliyor.
 *
 * YETKİ her zaman rollerin TOPLAMIdır. Arayüzdeki "şu an hangi şapkayla
 * çalışıyorum" seçimi (bkz. auth.tsx → activeRole) yalnızca menüyü ve
 * ekranları daraltır; kişinin yapabileceklerini genişletmez ya da
 * daraltmaz — sunucu zaten rollerin toplamına bakar.
 */
import type { Role } from "./auth";

/** En yetkiliden en azına. "Birincil rol" bu sıranın ilkidir. */
export const ROLE_ORDER: Role[] = ["ADMIN", "MANAGER", "INSTRUCTOR", "USER", "CUSTOMER"];

type RoleCarrier = { roles?: string[] | null; role?: string | null };

/**
 * Kişinin bütün rolleri. `roles` yoksa tek `role` alanına düşer — henüz
 * taşınmamış kayıtlar da doğru okunsun diye.
 */
export function rolesOf(u: RoleCarrier | null | undefined): Role[] {
  if (!u) return [];
  const list = (u.roles ?? []).filter(Boolean) as Role[];
  if (list.length > 0) return dedupe(list);
  return u.role ? [u.role as Role] : [];
}

/** Rollerin en yetkilisi. Boşsa USER — yetkisiz bırakmak yerine en azı. */
export function primaryRole(roles: Role[]): Role {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return "USER";
}

/** Bu kişi şu role sahip mi? Aktif seçimden bağımsız — gerçek yetki. */
export const hasRole = (u: RoleCarrier | null | undefined, r: Role) => rolesOf(u).includes(r);

/** Rolleri yetki sırasına diz, tekrarları at. */
export function sortRoles(roles: Role[]): Role[] {
  return ROLE_ORDER.filter((r) => roles.includes(r));
}

function dedupe(list: Role[]): Role[] {
  return sortRoles(list);
}

/**
 * CUSTOMER başka hiçbir rolle birleşmez: müşteri personel değil, kurum
 * uyumuna ve Follow-Up matrisine girmez. İkisi birden işaretlenirse
 * hangisinin geçerli olduğu belirsiz kalırdı.
 */
export function roleConflict(roles: Role[]): string | null {
  if (roles.length === 0) return "Pick at least one role.";
  if (roles.includes("CUSTOMER") && roles.length > 1)
    return "Customer cannot be combined with another role — a customer is not staff.";
  return null;
}
