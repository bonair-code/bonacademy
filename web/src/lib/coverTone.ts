/**
 * Kapak görseli olmayan kurslar için başlıktan türetilen sabit renk.
 *
 * Aynı kurs her zaman aynı rengi alır, böylece kart ızgarasında tanınır olur.
 * Kurs formundaki önizleme ile öğrencinin gördüğü kart aynı fonksiyonu
 * kullanmak zorunda — ayrı ayrı yazılırsa iki yerde farklı renk çıkardı.
 */
export type Tone = { from: string; to: string };

const PALETTE: Tone[] = [
  { from: "#3a3a3c", to: "#1c1c1e" },
  { from: "#1f3f6e", to: "#12253f" },
  { from: "#8b1013", to: "#4e090c" },
  { from: "#2d5d4f", to: "#16332b" },
  { from: "#5b3a7e", to: "#2f1d43" },
  { from: "#8a5a12", to: "#4a3009" },
];

export function coverTone(title: string): Tone {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
