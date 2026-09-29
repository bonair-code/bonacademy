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

/** Sertifika: yatay A4, kenarlıksız. */
export function printCertificate() {
  withPageStyle("@page { size: A4 landscape; margin: 0; }", () => window.print(), "");
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
