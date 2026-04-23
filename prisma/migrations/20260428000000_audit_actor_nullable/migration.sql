-- AuditLog.actorId → nullable + FK davranışı ON DELETE SET NULL.
-- Kullanıcı silindiğinde log satırı kaybolmasın; yasal kanıt olarak
-- kalsın (aktör artık null → "silinmiş kullanıcı" olarak gösterilir).

-- Eski FK'yı düşür.
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_fkey";

-- Kolonu nullable yap.
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;

-- Yeni FK — SET NULL.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Query performansı: denetim sayfasında en sık filtreler.
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
