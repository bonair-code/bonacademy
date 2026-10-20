/**
 * Kayıtlardan gelen dosya adresleri (PDF, video, dış eğitim belgesi) için
 * güvenli süzgeç.
 *
 * Adresler veritabanından geliyor ve eğitmen/müdür tarafından yazılabiliyor.
 * React `href`/`src` içindeki `javascript:` adreslerini engellemiyor: böyle
 * bir adres yönetici tıkladığında uygulamanın kendi kökeninde kod çalıştırırdı
 * (güvenlik incelemesi, 08.10.2026). Yalnızca Firebase Storage ve uygulamanın
 * kendi adresleri kabul edilir; gerisi null.
 */
export function safeFileUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u, window.location.origin);
    if (x.origin === window.location.origin) return x.href;
    if (x.protocol === "https:" && x.hostname === "firebasestorage.googleapis.com") return x.href;
    return null;
  } catch {
    return null;
  }
}

/**
 * Önizleme için indirilen dosyanın türü ZORLANIR: yalnızca PDF ve düz
 * görseller. Blob adresi uygulamayla aynı kökende çalıştığı için yüklenmiş bir
 * HTML/SVG dosyası olduğu gibi gösterilse içindeki betik çalışırdı.
 */
export function safePreviewType(b: Blob, fileName?: string | null): string {
  const t = (b.type || "").toLowerCase();
  if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(t)) return t;
  const n = (fileName || "").toLowerCase();
  if (/\.(png)$/.test(n)) return "image/png";
  if (/\.(jpe?g)$/.test(n)) return "image/jpeg";
  if (/\.(webp)$/.test(n)) return "image/webp";
  return "application/pdf";
}
