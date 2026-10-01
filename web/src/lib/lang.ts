/**
 * Eğitim dili.
 *
 * Bir eğitim tek kayıttır — tek sertifika numarası serisi, matriste tek sütun,
 * yetki kapsamında tek satır. İçinde DİL SÜRÜMLERİ vardır: her sürümün kendi
 * bölümleri, kendi içeriği, kendi soru bankası ve kendi yayın durumu.
 *
 * Yani İngilizce sürüm Türkçenin iskeletine mahkûm değil; ayrı bir eğitim
 * kurar gibi kurulur ve ayrı yayınlanır. Öğrenci yalnızca YAYINLANMIŞ dilleri
 * görür — yarım kalmış bir çeviri kimseye görünmez.
 *
 * Yeni dil eklemek: buraya bir satır, components/Flag.tsx'e bir bayrak.
 */
export type Lang = "TR" | "EN";

export const LANGS: Lang[] = ["TR", "EN"];

export const LANG_LABEL: Record<Lang, string> = {
  TR: "Türkçe",
  EN: "English",
};

/** Dar yerlerde (sekme, rozet) kullanılan kısa etiket. */
export const LANG_SHORT: Record<Lang, string> = { TR: "TR", EN: "EN" };

/** Bilinmeyen/boş değerleri güvenli bir dile indirger. */
export function asLang(v: unknown): Lang {
  return String(v ?? "").toUpperCase() === "EN" ? "EN" : "TR";
}

/** Kursun yayınlanmış dilleri — bozuk/eksik alan güvenli listeye çevrilir. */
export function publishedLangsOf(course: { publishedLangs?: unknown }): Lang[] {
  const raw = Array.isArray(course.publishedLangs) ? course.publishedLangs : [];
  const set = new Set(raw.map(asLang));
  return LANGS.filter((l) => set.has(l));
}

/** `lang` alanı taşıyan kayıtları (bölüm, soru) bir dile göre süzer. */
export function ofLang<T extends { lang?: unknown }>(rows: T[], lang: Lang): T[] {
  return rows.filter((r) => asLang(r.lang) === lang);
}
