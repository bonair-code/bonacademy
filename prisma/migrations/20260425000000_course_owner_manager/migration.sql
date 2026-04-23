-- Course modeline sorumlu yönetici (ownerManagerId) alanı ekleniyor.
-- Nullable tutuldu ki mevcut kurslar migration'da patlamasın; uygulama
-- seviyesinde yeni kurs oluştururken zorunlu kılınır. Silme davranışı
-- RESTRICT: sorumlu yönetici silinmeden önce Course.ownerManagerId
-- başka bir yöneticiye taşınmalı.
ALTER TABLE "Course" ADD COLUMN "ownerManagerId" TEXT;

CREATE INDEX "Course_ownerManagerId_idx" ON "Course"("ownerManagerId");

ALTER TABLE "Course"
  ADD CONSTRAINT "Course_ownerManagerId_fkey"
  FOREIGN KEY ("ownerManagerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
