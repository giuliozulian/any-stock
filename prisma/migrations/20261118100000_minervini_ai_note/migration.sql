-- CreateTable
CREATE TABLE "MinerviniAiNote" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinerviniAiNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MinerviniAiNote_symbol_day_key" ON "MinerviniAiNote"("symbol", "day");
