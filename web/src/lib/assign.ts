/**
 * `assignCourses` Function'ının tek sarmalayıcısı.
 *
 * Üç ekran atama yapıyor (Assignments, Users satır menüsü, Training Follow-Up
 * matrisi) ve her biri çağrının dönüş şeklini kendi bilmek zorunda kalıyordu.
 * Fonksiyon artık atladığı kalemleri sebebiyle geri veriyor — "20 kişiye
 * atadım" deyip 12'sini sessizce atlamak bu projede zaten bir kez oldu.
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type AssignResult = {
  /** Gerçekten açılan atama sayısı. */
  created: number;
  /** Atlananların sebepleri (yayında değil, içeriği yok, zaten atanmış…). */
  skipped: string[];
};

export async function assignCourses(
  userId: string,
  courseIds: string[],
  dueDays?: number
): Promise<AssignResult> {
  const res = await httpsCallable(functions, "assignCourses")({
    userId,
    courseIds,
    ...(dueDays ? { dueDays } : {}),
  });
  const d = res.data as { created?: number; skipped?: { reason: string }[] };
  return { created: d?.created ?? 0, skipped: (d?.skipped ?? []).map((s) => s.reason) };
}

/**
 * Atlananlar için kullanıcıya gösterilecek kuyruk metni. Aynı sebep birden
 * çok kalemde tekrar ediyorsa bir kez yazılır, sayısıyla.
 */
export function skipNote(skipped: string[]): string {
  if (skipped.length === 0) return "";
  const counts = new Map<string, number>();
  for (const r of skipped) counts.set(r, (counts.get(r) ?? 0) + 1);
  const parts = [...counts.entries()].map(([r, n]) => (n > 1 ? `${r} (${n})` : r));
  return ` ${skipped.length} skipped — ${parts.join(" ")}`;
}
