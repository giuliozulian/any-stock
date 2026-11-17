-- AlterTable
ALTER TABLE "DiscoveredCandidate" ADD COLUMN     "price" DOUBLE PRECISION,
ADD COLUMN     "changePct" DOUBLE PRECISION,
ADD COLUMN     "marketCap" DOUBLE PRECISION,
ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "spark" JSONB,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "prevScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DiscoveryHistory" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,

    CONSTRAINT "DiscoveryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryHistory_symbol_scannedAt_idx" ON "DiscoveryHistory"("symbol", "scannedAt");

-- CreateIndex
CREATE INDEX "DiscoveryHistory_scannedAt_idx" ON "DiscoveryHistory"("scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryDismissal_userId_symbol_key" ON "DiscoveryDismissal"("userId", "symbol");
