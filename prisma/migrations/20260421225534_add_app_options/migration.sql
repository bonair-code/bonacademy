-- CreateTable
CREATE TABLE "AppOption" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppOption_category_idx" ON "AppOption"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AppOption_category_label_key" ON "AppOption"("category", "label");
