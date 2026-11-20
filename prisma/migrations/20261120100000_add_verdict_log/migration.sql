-- CreateTable
CREATE TABLE "VerdictLog" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "refDate" TEXT NOT NULL,
    "refPrice" DOUBLE PRECISION NOT NULL,
    "overall" TEXT NOT NULL,
    "score" INTEGER,
    "shortTerm" TEXT NOT NULL,
    "shortTermLabel" TEXT NOT NULL,
    "mediumTerm" TEXT NOT NULL,
    "mediumTermLabel" TEXT NOT NULL,
    "longTerm" TEXT NOT NULL,
    "longTermLabel" TEXT NOT NULL,
    "fairValue" TEXT NOT NULL,
    "fairValueNote" TEXT NOT NULL,
    "news" TEXT NOT NULL,
    "newsNote" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerdictLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerdictOutcome" (
    "id" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL,
    "evalDate" TEXT NOT NULL,
    "stockReturnPct" DOUBLE PRECISION NOT NULL,
    "benchReturnPct" DOUBLE PRECISION NOT NULL,
    "excessPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerdictOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerdictLog_rulesVersion_idx" ON "VerdictLog"("rulesVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VerdictLog_stockId_day_key" ON "VerdictLog"("stockId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "VerdictOutcome_verdictId_horizon_key" ON "VerdictOutcome"("verdictId", "horizon");

-- AddForeignKey
ALTER TABLE "VerdictLog" ADD CONSTRAINT "VerdictLog_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerdictOutcome" ADD CONSTRAINT "VerdictOutcome_verdictId_fkey" FOREIGN KEY ("verdictId") REFERENCES "VerdictLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
