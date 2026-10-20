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
  /** Bildirim e-postası: gönderildi / gönderilemedi / hiç denenmedi (null). */
  mailed: boolean | null;
};

export async function assignCourses(
  userId: string,
  courseIds: string[],
  opts: {
    /** Son tarih "YYYY-MM-DD". Boşsa son tarih YOK (CAPELLA kararı). */
    dueDate?: string | null;
    /** Kişiye "yeni eğitim atandı" e-postası gitsin mi (varsayılan evet). */
    notify?: boolean;
  } = {}
): Promise<AssignResult> {
  const res = await httpsCallable(functions, "assignCourses")({
    userId,
    courseIds,
    notify: opts.notify !== false,
    dueDate: opts.dueDate || null,
  });
  const d = res.data as { created?: number; skipped?: { reason: string }[]; mail?: { ok: boolean } | null };
  return {
    created: d?.created ?? 0,
    skipped: (d?.skipped ?? []).map((s) => s.reason),
    mailed: d?.mail ? d.mail.ok : null,
  };
}

/** Toplu atamanın e-posta özeti: "Email sent." / "2 emails could not be sent." */
export function mailNote(results: AssignResult[]): string {
  const tried = results.filter((r) => r.mailed !== null);
  if (tried.length === 0) return "";
  const failed = tried.filter((r) => !r.mailed).length;
  if (failed === 0) return tried.length === 1 ? " Email sent." : ` ${tried.length} emails sent.`;
  return ` ${failed} email${failed === 1 ? "" : "s"} could not be sent.`;
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
