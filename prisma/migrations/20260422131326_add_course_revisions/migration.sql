-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "revisionNumber" INTEGER;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "currentRevision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CourseRevision" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scormPackagePath" TEXT,
    "scormEntryPoint" TEXT,
    "scormVersion" "ScormVersion" NOT NULL,
    "passingScore" INTEGER NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseRevision_courseId_idx" ON "CourseRevision"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRevision_courseId_revisionNumber_key" ON "CourseRevision"("courseId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "CourseRevision" ADD CONSTRAINT "CourseRevision_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRevision" ADD CONSTRAINT "CourseRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
