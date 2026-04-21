export function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "2-digit" });
}
