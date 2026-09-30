/**
 * Zorunlu eğitim hesabı — tek kaynak.
 *
 * Tek bir kavram var: **Authorisation Scope**. Kişiye kullanıcı kaydından bir
 * veya birden fazla kapsam verilir; her kapsamın gerekli eğitim listesi
 * ayarlardan tanımlanır. Kapsamın altında tiklenebilir **alt yetkiler**
 * olabilir (örn. Auditor → Procedures / Product / Quality / NDT); alt yetkinin
 * eğitimi yalnızca o alt yetkiyi taşıyan kişide zorunludur.
 *
 * Böylece "NDT yetkisi olmayan denetçide NDT Familiarization MISSING görünüyor"
 * sorunu ortadan kalkar.
 *
 * Veritabanında koleksiyon adı geçmişten `jobTitles`, kullanıcıdaki alan
 * `jobTitleIds` olarak kaldı — taşıma riski almamak için yalnızca arayüz
 * etiketleri değiştirildi.
 */

/**
 * Alt yetki — kapsamın altındaki tiklenebilir kalem.
 * Örn. "Auditor" → Procedures / Product / Quality / NDT.
 */
export type SubScope = {
  id: string;
  name: string;
  requiredCourseIds?: string[];
  /**
   * Bu alt yetki taşındığında kapsamın gerekliliğinden DÜŞEN eğitimler.
   * Gerçek örnek: Certifying Staff'ta English Exam zorunlu, ama NDT Staff
   * release yetkisi kullanmadığı için onda gerekmiyor. Alt yetki yalnızca
   * ekleyebildiği sürece bu durum modellenemiyordu.
   */
  excludedCourseIds?: string[];
};

export type Scope = {
  id: string;
  name: string;
  requiredCourseIds?: string[];
  subScopes?: SubScope[];
};

export type CourseLike = { id: string };

export type RequirementReason = "SCOPE" | "SUB_SCOPE" | null;

/** Kapsamın altındaki tüm alt yetkiler — kullanıcı formundaki tikler için. */
export function subScopesOf(scopeIds: string[], scopes: Scope[]): SubScope[] {
  const out: SubScope[] = [];
  for (const s of scopes) {
    if (scopeIds.includes(s.id)) out.push(...(s.subScopes ?? []));
  }
  return out;
}

/**
 * Kurs bu kişi için zorunlu mu?
 * İki kaynak: kapsamın kendi gerekli eğitimleri (o kapsamdaki herkese) ve
 * kişide tikli alt yetkilerin gerekli eğitimleri (yalnızca onu taşıyana).
 */
export function requirementFor(
  course: CourseLike,
  scopeIds: string[],
  scopes: Scope[],
  subScopeIds: string[] = []
): RequirementReason {
  // Muafiyet her şeyden önce gelir: alt yetki bir eğitimi düşürüyorsa,
  // kapsamın onu zorunlu tutması sonucu değiştirmez.
  if (exclusionFor(course, scopeIds, scopes, subScopeIds)) return null;

  const held = new Set(subScopeIds);
  for (const s of scopes) {
    if (!scopeIds.includes(s.id)) continue;
    if ((s.requiredCourseIds ?? []).includes(course.id)) return "SCOPE";
    for (const sub of s.subScopes ?? []) {
      if (held.has(sub.id) && (sub.requiredCourseIds ?? []).includes(course.id)) {
        return "SUB_SCOPE";
      }
    }
  }
  return null;
}

/**
 * Bu eğitim kişide hangi alt yetki yüzünden gerekmiyor? Adı döner, yoksa null.
 * Arayüz bunu gösterir: muafiyetin sessizce kaybolması, uygunsuzluğu
 * gizlemekle aynı şey olurdu.
 */
export function exclusionFor(
  course: CourseLike,
  scopeIds: string[],
  scopes: Scope[],
  subScopeIds: string[] = []
): string | null {
  const held = new Set(subScopeIds);
  for (const s of scopes) {
    if (!scopeIds.includes(s.id)) continue;
    for (const sub of s.subScopes ?? []) {
      if (held.has(sub.id) && (sub.excludedCourseIds ?? []).includes(course.id)) return sub.name;
    }
  }
  return null;
}
