-- CreateTable
CREATE TABLE "MoveExplanation" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoveExplanation_symbol_day_key" ON "MoveExplanation"("symbol", "day");
