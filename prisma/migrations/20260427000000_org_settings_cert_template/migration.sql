-- Sertifika şablonu snapshot'ı için Certificate'e JSON alan.
ALTER TABLE "Certificate" ADD COLUMN "templateSnapshot" JSONB;

-- Tek-satırlı kurum ayarları.
CREATE TABLE "OrganizationSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "certAccentColor" TEXT NOT NULL DEFAULT '#e30613',
  "certTitleAchievement" TEXT NOT NULL DEFAULT 'BAŞARI SERTİFİKASI',
  "certTitleParticipation" TEXT NOT NULL DEFAULT 'KATILIM SERTİFİKASI',
  "certSubtitleAchievement" TEXT NOT NULL DEFAULT 'CERTIFICATE OF ACHIEVEMENT',
  "certSubtitleParticipation" TEXT NOT NULL DEFAULT 'CERTIFICATE OF PARTICIPATION',
  "certBodyAchievement" TEXT NOT NULL DEFAULT 'eğitimini başarıyla tamamladığını belgelemek üzere düzenlenmiştir.',
  "certBodyParticipation" TEXT NOT NULL DEFAULT 'eğitimine katıldığını belgelemek üzere düzenlenmiştir.',
  "certFooterLine" TEXT NOT NULL DEFAULT 'Bon Air Havacılık Sanayi ve Ticaret A.Ş. · BonAcademy',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- Başlangıç satırı (upsert idempotent tutar ama güvenli olsun).
INSERT INTO "OrganizationSettings" ("id", "updatedAt") VALUES ('singleton', NOW())
ON CONFLICT ("id") DO NOTHING;
