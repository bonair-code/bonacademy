/**
 * Kişi diyaloglarının ortak tipleri.
 *
 * UserDialogs.tsx içindeydiler; ScopePicker de aynılarını kullanınca iki
 * bileşen birbirini import eder duruma geldi. Tipler ayrı dosyada durursa
 * o döngü hiç kurulmuyor.
 */
import type { Role } from "../../lib/auth";
import type { SubScope } from "../../lib/requirements";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  jobTitleIds?: string[];
  subScopeIds?: string[];
  /** Sertifikadaki "PLACE & DATE of BIRTH" satırı için. */
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  /** Metod bazlı eğitimlerde kişinin yetkili olduğu metodlar. */
  courseMethods?: Record<string, string[]>;
  /** Müşteri hesabının bağlı olduğu kurum; personelde boş. */
  company?: string | null;
  isActive: boolean;
  /** Davet e-postası gönderildi / kişi bağlantıyla şifresini belirledi. */
  invitedAt?: unknown;
  inviteAcceptedAt?: unknown;
  inviteEmailStatus?: "SENT" | "FAILED";
};

export type Ref = { id: string; name: string };
export type MethodCourse = { id: string; title: string; methods: string[] };

/**
 * `requiredCourseIds` ŞART: kullanıcı formu "bu kapsam kaç eğitim getiriyor"
 * yazıyor ve bunu kapsamın kendi listesinden hesaplıyor (bkz.
 * lib/requirements.ts → requiredCourseIdsFor). Sayfalar bu alanı
 * doldurmazsa sayı herkeste 0 görünür.
 */
export type ScopeRef = Ref & { requiredCourseIds?: string[]; subScopes?: SubScope[] };

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  INSTRUCTOR: "Instructor",
  USER: "Employee",
  CUSTOMER: "Customer",
};
