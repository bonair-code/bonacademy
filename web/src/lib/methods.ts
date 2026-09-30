/**
 * Metod bazlı eğitimler — tek kaynak.
 *
 * Bazı eğitimler tek bir belge değil, birden çok **metod** demek. NDT en tipik
 * örneği: kişi PT ve MT'de yetkili olabilir, her metodun kendi belgesi ve
 * kendi bitiş tarihi vardır. Kişi metodlarından birini yenilemezse o metoddaki
 * yetkisi düşer — diğerleri geçerli olsa bile.
 *
 * Bu dosya Follow-Up matrisi ile Dashboard uygunluk hesabının AYNI sonucu
 * vermesi için var. Aynı hesabın iki dosyada ayrı yazılması daha önce üç
 * ekranın üç farklı cevap vermesine yol açmıştı.
 */

/** Kursun bölündüğü metodlar; boşsa kurs metod bazlı değildir. */
export function methodsOf(course: { methods?: string[] | null }): string[] {
  return (course.methods ?? []).filter(Boolean);
}

/** Kişinin bu kursta yetkili olduğu metodlar. */
export function heldMethods(
  user: { courseMethods?: Record<string, string[]> | null },
  courseId: string
): string[] {
  return (user.courseMethods?.[courseId] ?? []).filter(Boolean);
}

export type MethodRecord = {
  method?: string | null;
  date: Date;
  expiry: Date | null;
  /** Yüklenen belgenin bağlantısı; kâğıt kayıtta boş. */
  url?: string | null;
};

export type MethodRow = {
  method: string;
  /** Bu metodun en son kaydı; hiç yoksa null. */
  date: Date | null;
  expiry: Date | null;
  url?: string | null;
};

/**
 * Kişinin tikli her metodu için en son kaydı eşler. Metodu yazılmamış eski
 * kayıtlar hiçbir metoda sayılmaz — hangi metoda ait olduğu bilinmeden
 * "bu metod tamam" demek, olmayan bir yetkiyi geçerli göstermek olurdu.
 */
export function methodBreakdown(ticked: string[], records: MethodRecord[]): MethodRow[] {
  return ticked.map((m) => {
    let best: MethodRecord | null = null;
    for (const r of records) {
      if ((r.method ?? "") !== m) continue;
      if (!best || r.date > best.date) best = r;
    }
    return {
      method: m,
      date: best?.date ?? null,
      expiry: best?.expiry ?? null,
      url: best?.url ?? null,
    };
  });
}

/**
 * Metodların toplu sonucu. Kural: **en kötü metod belirler.**
 * Bir metodun belgesi yoksa kişi o eğitimde eksiktir; hepsi varsa geçerlilik
 * en erken dolan metoda göre verilir.
 */
export function worstOf(rows: MethodRow[]): {
  missing: string[];
  date: Date | null;
  expiry: Date | null;
} {
  const missing = rows.filter((r) => !r.date).map((r) => r.method);
  const have = rows.filter((r) => r.date);
  // Tamamlanma tarihi olarak en ESKİ metod alınır: eğitimin bütünü ancak
  // son metod da alındığında tamamlanmış sayılır, ama süre en eskiden işler.
  let date: Date | null = null;
  let expiry: Date | null = null;
  let expirySeen = false;
  for (const r of have) {
    if (r.date && (!date || r.date < date)) date = r.date;
    if (r.expiry) {
      if (!expirySeen || (expiry && r.expiry < expiry)) expiry = r.expiry;
      expirySeen = true;
    }
  }
  return { missing, date, expiry };
}
