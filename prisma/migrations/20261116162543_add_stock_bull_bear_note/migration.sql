-- CreateTable
CREATE TABLE "StockBullBearNote" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "bull" TEXT[],
    "bear" TEXT[],
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBullBearNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockBullBearNote_stockId_key" ON "StockBullBearNote"("stockId");

-- AddForeignKey
ALTER TABLE "StockBullBearNote" ADD CONSTRAINT "StockBullBearNote_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
