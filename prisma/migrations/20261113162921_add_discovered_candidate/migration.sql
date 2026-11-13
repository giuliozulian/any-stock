-- CreateTable
CREATE TABLE "DiscoveredCandidate" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "momentumScore" DOUBLE PRECISION NOT NULL,
    "fundamentalsScore" DOUBLE PRECISION NOT NULL,
    "insiderScore" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveredCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredCandidate_symbol_key" ON "DiscoveredCandidate"("symbol");

-- CreateIndex
CREATE INDEX "DiscoveredCandidate_score_idx" ON "DiscoveredCandidate"("score");
