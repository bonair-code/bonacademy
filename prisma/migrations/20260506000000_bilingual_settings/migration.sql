-- Bilingual settings: TR/EN alanları
ALTER TABLE "Department" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "JobTitle"   ADD COLUMN "nameEn" TEXT;
ALTER TABLE "AppOption"  ADD COLUMN "labelEn" TEXT;
