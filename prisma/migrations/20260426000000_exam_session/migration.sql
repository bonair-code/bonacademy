-- Sınav snapshot'ı: hangi soruların sorulduğu server tarafında tutulur ki
-- submit manipülasyonu (eksik cevap gönderip %100 alma) engellensin.
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "questionIds" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamSession_assignmentId_attemptNo_key"
    ON "ExamSession"("assignmentId", "attemptNo");

CREATE INDEX "ExamSession_assignmentId_idx" ON "ExamSession"("assignmentId");

ALTER TABLE "ExamSession"
  ADD CONSTRAINT "ExamSession_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
