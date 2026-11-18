-- CreateTable
CREATE TABLE "ScanExtra" (
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanExtra_pkey" PRIMARY KEY ("symbol")
);
