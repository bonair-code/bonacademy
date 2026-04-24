-- DropIndex
DROP INDEX "Assignment_triggeredById_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';
