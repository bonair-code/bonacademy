-- AssignmentTrigger enum + Assignment.triggeredBy/triggeredById/triggerReason
-- Amaç: bir assignment'ın hangi yolla oluştuğunu izlemek (cron, kullanıcı
-- gönüllü tekrarı, yönetici zorunlu tekrarı).

CREATE TYPE "AssignmentTrigger" AS ENUM ('AUTO', 'VOLUNTARY', 'MANAGER_REQUESTED');

ALTER TABLE "Assignment"
  ADD COLUMN "triggeredBy"   "AssignmentTrigger" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "triggeredById" TEXT,
  ADD COLUMN "triggerReason" TEXT;

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Assignment_triggeredById_idx" ON "Assignment"("triggeredById");
