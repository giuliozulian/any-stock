-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "status" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "barDate" TIMESTAMP(3),
    "weightedReturn" DOUBLE PRECISION,
    "criteria" JSONB,
    "rs" DOUBLE PRECISION,
    "passedCount" INTEGER,
    "vcpStatus" TEXT,
    "pivot" DOUBLE PRECISION,
    "pivotDistancePct" DOUBLE PRECISION,
    "contractions" JSONB,
    "volumeDryUp" BOOLEAN,

    CONSTRAINT "ScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanRun_status_finishedAt_idx" ON "ScanRun"("status", "finishedAt");

-- CreateIndex
CREATE INDEX "ScanResult_runId_passedCount_idx" ON "ScanResult"("runId", "passedCount");

-- CreateIndex
CREATE UNIQUE INDEX "ScanResult_runId_symbol_key" ON "ScanResult"("runId", "symbol");

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
