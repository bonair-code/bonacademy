import { prisma } from "@/lib/db";

// Sertifika şablonunun PDF render'ına aktarılacak dondurulmuş biçimi.
// Bu shape değiştiğinde: (1) eski snapshot'larla geriye dönük uyum bozulur,
// (2) loadTemplateFromSnapshot'ta eksik alanlar default'a dönmeli. Alan
// eklemeler geriye dönük uyumludur, alan kaldırma/yeniden adlandırma değil.
export type CertificateTemplate = {
  accentColor: string;
  titleAchievement: string;
  titleParticipation: string;
  subtitleAchievement: string;
  subtitleParticipation: string;
  bodyAchievement: string;
  bodyParticipation: string;
  footerLine: string;
};

// Fabrika default — DB'de henüz satır yoksa veya snapshot'ta alan eksikse
// bu değerler kullanılır. Prisma schema default'larıyla eşit tutulmalı.
export const DEFAULT_CERTIFICATE_TEMPLATE: CertificateTemplate = {
  accentColor: "#e30613",
  titleAchievement: "BAŞARI SERTİFİKASI",
  titleParticipation: "KATILIM SERTİFİKASI",
  subtitleAchievement: "CERTIFICATE OF ACHIEVEMENT",
  subtitleParticipation: "CERTIFICATE OF PARTICIPATION",
  bodyAchievement:
    "eğitimini başarıyla tamamladığını belgelemek üzere düzenlenmiştir.",
  bodyParticipation:
    "eğitimine katıldığını belgelemek üzere düzenlenmiştir.",
  footerLine: "Bon Air Havacılık Sanayi ve Ticaret A.Ş. · BonAcademy",
};

/** Admin formdan gelen hex renk doğrulaması — PDF render'ını bozmasın. */
export function isValidHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** DB'deki OrganizationSettings satırını okur; yoksa default döner. */
export async function loadCurrentCertificateTemplate(): Promise<CertificateTemplate> {
  const row = await prisma.organizationSettings.findUnique({
    where: { id: "singleton" },
  });
  if (!row) return DEFAULT_CERTIFICATE_TEMPLATE;
  return {
    accentColor: row.certAccentColor,
    titleAchievement: row.certTitleAchievement,
    titleParticipation: row.certTitleParticipation,
    subtitleAchievement: row.certSubtitleAchievement,
    subtitleParticipation: row.certSubtitleParticipation,
    bodyAchievement: row.certBodyAchievement,
    bodyParticipation: row.certBodyParticipation,
    footerLine: row.certFooterLine,
  };
}

/** Snapshot JSON'dan şablon oku; eksik alan varsa default'a düş. */
export function loadTemplateFromSnapshot(
  snapshot: unknown
): CertificateTemplate {
  if (!snapshot || typeof snapshot !== "object") {
    return DEFAULT_CERTIFICATE_TEMPLATE;
  }
  const s = snapshot as Partial<CertificateTemplate>;
  return {
    accentColor:
      typeof s.accentColor === "string" && isValidHexColor(s.accentColor)
        ? s.accentColor
        : DEFAULT_CERTIFICATE_TEMPLATE.accentColor,
    titleAchievement:
      typeof s.titleAchievement === "string"
        ? s.titleAchievement
        : DEFAULT_CERTIFICATE_TEMPLATE.titleAchievement,
    titleParticipation:
      typeof s.titleParticipation === "string"
        ? s.titleParticipation
        : DEFAULT_CERTIFICATE_TEMPLATE.titleParticipation,
    subtitleAchievement:
      typeof s.subtitleAchievement === "string"
        ? s.subtitleAchievement
        : DEFAULT_CERTIFICATE_TEMPLATE.subtitleAchievement,
    subtitleParticipation:
      typeof s.subtitleParticipation === "string"
        ? s.subtitleParticipation
        : DEFAULT_CERTIFICATE_TEMPLATE.subtitleParticipation,
    bodyAchievement:
      typeof s.bodyAchievement === "string"
        ? s.bodyAchievement
        : DEFAULT_CERTIFICATE_TEMPLATE.bodyAchievement,
    bodyParticipation:
      typeof s.bodyParticipation === "string"
        ? s.bodyParticipation
        : DEFAULT_CERTIFICATE_TEMPLATE.bodyParticipation,
    footerLine:
      typeof s.footerLine === "string"
        ? s.footerLine
        : DEFAULT_CERTIFICATE_TEMPLATE.footerLine,
  };
}

// Alan bazlı uzunluk sınırları — PDF layout'u taşmasın.
export const TEMPLATE_FIELD_LIMITS = {
  title: 40,
  subtitle: 60,
  body: 220,
  footer: 120,
} as const;
