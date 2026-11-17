-- CreateTable
CREATE TABLE "ScanAlert" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "armedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "ScanAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerAlertSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "newEntrants" BOOLEAN NOT NULL DEFAULT false,
    "knownFull" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerAlertSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanAlert_symbol_key" ON "ScanAlert"("symbol");
