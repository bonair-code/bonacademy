/**
 * Eğitim içeriğinin dili.
 *
 * Bir eğitim tek kurs olarak durur; içeriği iki dilde yüklenir ve öğrenci
 * hangisinde çalışacağını seçer. İlerleme ortaktır — tamamlanan bölüm
 * `sectionsDone` içinde bölüm id'si olarak tutuluyor, içerik id'si olarak
 * değil, yani dil değiştirmek ilerlemeyi sıfırlamaz.
 *
 * `null` = dilden bağımsız içerik (şema, çizim, uygulama videosu): iki dilde
 * de gösterilir. Etiketsiz eski kayıtlar da bu kovaya düşer, böylece dil
 * eklemek var olan kursları bozmaz.
 */
export type Lang = "TR" | "EN";

export const LANGS: Lang[] = ["TR", "EN"];

export const LANG_LABEL: Record<Lang, string> = {
  TR: "Türkçe",
  EN: "English",
};

/** Dar yerlerde (içerik satırı, kurs kartı) kullanılan kısa etiket. */
export const LANG_SHORT: Record<Lang, string> = { TR: "TR", EN: "EN" };

export type WithLang = { lang?: Lang | null };

/**
 * Bu kalem seçilen dilde gösterilir mi? Etiketsiz kalem her dilde gösterilir.
 */
export function matchesLang(item: WithLang, lang: Lang): boolean {
  return !item.lang || item.lang === lang;
}

/**
 * İçerik listesinin gerçekten sunduğu diller. Etiketsiz kalemler bir dil
 * saymaz — "sadece Türkçe yüklenmiş" ile "dil ayrımı yapılmamış" farklı
 * şeyler ve kurs kartında ikisini aynı göstermek yanıltıcı olur.
 */
export function langsOf(items: WithLang[]): Lang[] {
  const s = new Set<Lang>();
  for (const i of items) if (i.lang) s.add(i.lang);
  return LANGS.filter((l) => s.has(l));
}

/**
 * Seçilen dil için gösterilecek kalemler.
 *
 * Bölümde o dilde hiç kalem yoksa HEPSİ döner: öğrenciyi boş ekranda bırakıp
 * bölümü tamamlayamaz hâle getirmektense, eldeki dili gösterip durumu
 * söylemek doğru. Tamamlama kapısı bu listeye bakıyor (`canComplete`), yani
 * boş liste dönmek kişiyi eğitimde kilitler.
 */
export function pickForLang<T extends WithLang>(
  items: T[],
  lang: Lang
): { items: T[]; fellBack: boolean } {
  const hit = items.filter((i) => matchesLang(i, lang));
  if (hit.length > 0) return { items: hit, fellBack: false };
  return { items, fellBack: items.length > 0 };
}

/** Çeviri varsa onu, yoksa aslını ver. Boş çeviri alanı yok sayılır. */
export function tr(base: string, english: string | null | undefined, lang: Lang): string {
  if (lang === "EN") return english?.trim() ? english : base;
  return base;
}
