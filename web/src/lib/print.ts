/**
 * Yazdırma yardımcıları. @page kuralı CSS'te gövde sınıfına göre değişemediği
 * için sayfa yönü baskı anında geçici bir <style> ile veriliyor.
 */
function withPageStyle(css: string, body: () => void, marker: string) {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
  if (marker) document.body.classList.add(marker);

  const cleanup = () => {
    el.remove();
    if (marker) document.body.classList.remove(marker);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  body();
  // afterprint bazı tarayıcılarda tetiklenmiyor; emniyet payı.
  setTimeout(cleanup, 3000);
}

/** "TALHA DUYGU" → "Talha Duygu" (Türkçe harf kurallarıyla). */
function titleCaseTr(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr"))
    .join(" ");
}

/**
 * PDF'in dosya adı: "Ad Soyad - Eğitim adı - Sertifika tarihi".
 *
 * Tarayıcının "PDF olarak kaydet" penceresi önerdiği dosya adını sayfa
 * başlığından (document.title) alıyor; bu yüzden baskı süresince başlık
 * geçici olarak değiştiriliyor. Dosya adında kullanılamayan karakterler
 * (eğitim adındaki "|" gibi) tireye çevrilir.
 */
export function certificateFileName(c: {
  userName?: string | null;
  courseTitle?: string | null;
  issuedAt?: { toDate?: () => Date } | null;
}) {
  const date = c.issuedAt?.toDate?.().toLocaleDateString("tr-TR") ?? "";
  return [titleCaseTr(c.userName ?? ""), (c.courseTitle ?? "").trim(), date]
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " - ")
    .replace(/\s*-\s*(-\s*)+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sertifika: yatay A4, kenarlıksız. Belge verilirse PDF adı ondan türetilir. */
export function printCertificate(cert?: Parameters<typeof certificateFileName>[0]) {
  const prevTitle = document.title;
  const name = cert ? certificateFileName(cert) : "";
  if (name) document.title = name;
  const restore = () => {
    document.title = prevTitle;
    window.removeEventListener("afterprint", restore);
  };
  if (name) {
    window.addEventListener("afterprint", restore);
    setTimeout(restore, 3000);
  }
  withPageStyle("@page { size: A4 landscape; margin: 0; }", () => window.print(), "");
}

/**
 * Yoklama QR'ı: dikey A4, tek sayfa.
 *
 * Eskiden sertifikanın `cert-print` sınıfını kullanıyordu; o sınıf sayfayı
 * tamamen kaplayacak biçimde yazıldığı için QR görseli devleşip ikinci
 * sayfaya taşıyordu.
 */
export function printQr() {
  withPageStyle("@page { size: A4 portrait; margin: 16mm; }", () => window.print(), "printing-qr");
}

/** Sayfa raporu. Geniş tablolar için yatay. */
export function printReport(opts: { landscape?: boolean } = {}) {
  const size = opts.landscape ? "A4 landscape" : "A4 portrait";
  withPageStyle(
    `@page { size: ${size}; margin: 14mm 12mm 20mm; }`,
    () => window.print(),
    "printing-report"
  );
}
