-- Sertifika şablonuna alan görünürlük bayrakları. Geriye dönük uyumluluk
-- için hepsi varsayılan true — mevcut satır davranışı değişmez.
ALTER TABLE "OrganizationSettings"
  ADD COLUMN "certShowBirthDate"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowBirthPlace"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowOwnerManager" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowQr"           BOOLEAN NOT NULL DEFAULT true;
