-- Kullanıcılara doğum tarihi + doğum yeri. Sertifikada görünmesi için.
-- İkisi de opsiyonel; eski kullanıcılar için doldurulana kadar sertifikada
-- kısaltılıp gösterilir ya da boş kalır.

ALTER TABLE "User"
  ADD COLUMN "birthDate"  DATE,
  ADD COLUMN "birthPlace" TEXT;
