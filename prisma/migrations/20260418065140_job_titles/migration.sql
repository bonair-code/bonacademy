-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJobTitle" (
    "userId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserJobTitle_pkey" PRIMARY KEY ("userId","jobTitleId")
);

-- CreateTable
CREATE TABLE "TrainingPlanJobTitle" (
    "planId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,

    CONSTRAINT "TrainingPlanJobTitle_pkey" PRIMARY KEY ("planId","jobTitleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_name_key" ON "JobTitle"("name");

-- CreateIndex
CREATE INDEX "UserJobTitle_jobTitleId_idx" ON "UserJobTitle"("jobTitleId");

-- CreateIndex
CREATE INDEX "TrainingPlanJobTitle_jobTitleId_idx" ON "TrainingPlanJobTitle"("jobTitleId");

-- AddForeignKey
ALTER TABLE "UserJobTitle" ADD CONSTRAINT "UserJobTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobTitle" ADD CONSTRAINT "UserJobTitle_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanJobTitle" ADD CONSTRAINT "TrainingPlanJobTitle_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanJobTitle" ADD CONSTRAINT "TrainingPlanJobTitle_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
