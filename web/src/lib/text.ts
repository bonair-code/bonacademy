/**
 * Yer adı biçimi: her kelimenin ilk harfi büyük, gerisi küçük — Türkçe harf
 * kurallarıyla ("İSTANBUL", "istanbul" → "İstanbul"; "ISPARTA" → "Isparta").
 * Doğum yeri sertifikaya basıldığı için kişi ne yazarsa yazsın aynı biçime
 * getiriliyor. Kelime ayıracı boşluk ve tire; fazla boşluklar tek boşluğa iner.
 *
 * Aynı kural sunucuda da var (functions/src/index.ts → placeCase); biri
 * değişirse diğeri de değişmeli.
 */
export function placeCase(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(/([ -])/)
    .map((w) => (w === " " || w === "-" ? w : w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr")))
    .join("");
}
