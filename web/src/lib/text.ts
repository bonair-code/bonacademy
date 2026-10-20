/**
 * İngilizce klavyeyle büyük "I" ile yazılınca Türkçe kural onu noktasız ı
 * sayıyor ("Istanbul" → "Istanbul", sertifikada "ıstanbul" bile çıktı).
 * Noktalı İ ile başlayan yaygın yer adları düzeltilir; anahtar ı → i
 * çevrilerek aranır. (Isparta, Iğdır noktasız — listede yok.)
 */
const DOTTED_I: Record<string, string> = {
  istanbul: "İstanbul",
  izmir: "İzmir",
  izmit: "İzmit",
  iskenderun: "İskenderun",
};

/**
 * Yer adı biçimi: her kelimenin ilk harfi büyük, gerisi küçük — Türkçe harf
 * kurallarıyla ("İSTANBUL", "istanbul", "Istanbul" → "İstanbul"; "ISPARTA" →
 * "Isparta"). Doğum yeri sertifikaya basıldığı için kişi ne yazarsa yazsın
 * aynı biçime getiriliyor. Kelime ayıracı boşluk ve tire; fazla boşluklar tek
 * boşluğa iner.
 *
 * Aynı kural sunucuda da var (functions/src/index.ts → placeCase); biri
 * değişirse diğeri de değişmeli.
 */
export function placeCase(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(/([ -])/)
    .map((w) => {
      if (w === " " || w === "-") return w;
      const low = w.toLocaleLowerCase("tr");
      return DOTTED_I[low.replace(/ı/g, "i")] ?? low.charAt(0).toLocaleUpperCase("tr") + low.slice(1);
    })
    .join("");
}
