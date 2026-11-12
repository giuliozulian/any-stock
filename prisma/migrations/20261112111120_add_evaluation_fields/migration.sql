-- AlterTable
ALTER TABLE "PriceSnapshot" ADD COLUMN     "debtToEquity" DOUBLE PRECISION,
ADD COLUMN     "dividendYield" DOUBLE PRECISION,
ADD COLUMN     "epsGrowth5Y" DOUBLE PRECISION,
ADD COLUMN     "epsTTM" DOUBLE PRECISION,
ADD COLUMN     "netMargin" DOUBLE PRECISION,
ADD COLUMN     "payoutRatio" DOUBLE PRECISION,
ADD COLUMN     "pegRatio" DOUBLE PRECISION,
ADD COLUMN     "relativePerf13W" DOUBLE PRECISION,
ADD COLUMN     "roe" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "AnalystRecommendation" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "strongBuy" INTEGER NOT NULL,
    "buy" INTEGER NOT NULL,
    "hold" INTEGER NOT NULL,
    "sell" INTEGER NOT NULL,
    "strongSell" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalystRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalystRecommendation_stockId_period_idx" ON "AnalystRecommendation"("stockId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "AnalystRecommendation_stockId_period_key" ON "AnalystRecommendation"("stockId", "period");

-- AddForeignKey
ALTER TABLE "AnalystRecommendation" ADD CONSTRAINT "AnalystRecommendation_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
