-- CreateTable
CREATE TABLE "NewsAnalysis" (
    "id" TEXT NOT NULL,
    "newsItemId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "horizon" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsAnalysis_newsItemId_key" ON "NewsAnalysis"("newsItemId");

-- AddForeignKey
ALTER TABLE "NewsAnalysis" ADD CONSTRAINT "NewsAnalysis_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
