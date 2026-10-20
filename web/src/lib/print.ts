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
  const undo = isolateForPrint(document.querySelector<HTMLElement>(".cert-print"));
  withPageStyle(CERT_PRINT_CSS, () => window.print(), "");
  window.addEventListener("afterprint", undo, { once: true });
  setTimeout(undo, 3000);
}

/**
 * Sertifika baskısı tam bir yatay A4 sayfa.
 *
 * Eskiden sayfanın geri kalanı yalnızca `visibility: hidden` ile gizleniyordu:
 * görünmüyor ama yer kaplıyordu, belge bir sayfadan uzun olunca PDF 2 sayfa
 * çıkıyordu. Artık sertifikanın dışındaki her şey düzenden çıkarılıyor
 * (display: none), sertifikayı saran kutular da sıfırlanıyor; geriye
 * yalnızca 297×210 mm'lik belge kalıyor.
 *
 * Bu da yetmedi: içerik 209.5 mm olduğu hâlde Chrome sona boş bir ikinci
 * sayfa ekliyordu (başsız Chrome'da PDF'e basılarak denendi; 195 mm'de tek,
 * 200 mm'de iki sayfa). Sayfa tam bir sayfa boyunda kırpılınca tek sayfa.
 */
const CERT_PRINT_CSS = `
@page { size: A4 landscape; margin: 0; }
@media print {
  html, body {
    margin: 0 !important; padding: 0 !important; background: #fff !important;
    height: 210mm !important; overflow: hidden !important;
  }
  .print-hide { display: none !important; }
  .print-chain {
    position: static !important; display: block !important; transform: none !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important;
    width: auto !important; min-width: 0 !important; max-width: none !important;
    height: auto !important; min-height: 0 !important; overflow: visible !important;
    background: #fff !important;
  }
  .cert-print.print-solo {
    position: static !important; width: 297mm !important; height: 209.5mm !important;
    aspect-ratio: auto !important; break-inside: avoid; page-break-inside: avoid;
  }
}`;

/** Sertifikayı saran zincir dışında her şeyi baskıdan çıkarır; geri alma işlevi döner. */
function isolateForPrint(sheet: HTMLElement | null): () => void {
  if (!sheet) return () => {};
  const marked: [Element, string][] = [];
  const mark = (el: Element, cls: string) => {
    el.classList.add(cls);
    marked.push([el, cls]);
  };
  mark(sheet, "print-solo");
  for (let el: HTMLElement = sheet; el.parentElement && el !== document.body; el = el.parentElement) {
    const parent = el.parentElement;
    for (const sib of Array.from(parent.children)) if (sib !== el) mark(sib, "print-hide");
    if (parent !== document.body) mark(parent, "print-chain");
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const [el, cls] of marked) el.classList.remove(cls);
  };
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
