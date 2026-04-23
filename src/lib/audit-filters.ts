// Denetim filtreleri için ortak yardımcılar. Hem /admin/audit sayfası hem de
// Excel export endpoint'i aynı validasyonu kullanır — böylece iki yerde
// drift olmaz.

/**
 * "YYYY-MM-DD" formatındaki tarihi Date'e çevirir. Geçersizse null döner
 * (boş string, çöp string, `new Date()` → Invalid Date durumu dahil).
 * `kind === "end"` ise günü 23:59:59.999'a kadar kapsayacak biçimde ayarlar.
 */
export function parseFilterDate(
  raw: string | null | undefined,
  kind: "start" | "end"
): Date | null {
  if (!raw) return null;
  // Sadece YYYY-MM-DD formatı (HTML <input type="date">). Diğer bilinmeyen
  // stringler kabul edilmez ki 500 hatası / index full-scan olmasın.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (kind === "end") d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}
