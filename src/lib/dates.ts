// Vercel/serverless Node.js UTC'de çalışır. toLocaleDateString("tr-TR")
// timezone vermediği için tarih bir gün kayabilir. Tüm kullanıcıya görünen
// tarih/zaman biçimlendirmelerini bu yardımcılardan geçir.
const TZ = "Europe/Istanbul";

export function fmtTrDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("tr-TR", { timeZone: TZ });
}

export function fmtTrDateTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("tr-TR", { timeZone: TZ });
}
