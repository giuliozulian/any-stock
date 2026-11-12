-- CreateTable
CREATE TABLE "StockInsight" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "keyPoints" TEXT[],
    "risks" TEXT[],
    "confidence" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockInsight_stockId_key" ON "StockInsight"("stockId");

-- AddForeignKey
ALTER TABLE "StockInsight" ADD CONSTRAINT "StockInsight_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
