-- CreateTable
CREATE TABLE "StockEarningsNote" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "watchFor" TEXT[],
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockEarningsNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockEarningsNote_stockId_key" ON "StockEarningsNote"("stockId");

-- AddForeignKey
ALTER TABLE "StockEarningsNote" ADD CONSTRAINT "StockEarningsNote_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
