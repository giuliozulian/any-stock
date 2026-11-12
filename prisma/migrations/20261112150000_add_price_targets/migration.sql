-- AlterTable
ALTER TABLE "Stock" ADD COLUMN     "entryPrice" DOUBLE PRECISION,
ADD COLUMN     "entryTriggeredAt" TIMESTAMP(3),
ADD COLUMN     "sellPrice" DOUBLE PRECISION,
ADD COLUMN     "sellTriggeredAt" TIMESTAMP(3);
