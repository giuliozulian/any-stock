-- CreateTable
CREATE TABLE "StockVerdictNote" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "watchFor" TEXT[],
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockVerdictNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockVerdictNote_stockId_key" ON "StockVerdictNote"("stockId");

-- AddForeignKey
ALTER TABLE "StockVerdictNote" ADD CONSTRAINT "StockVerdictNote_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
