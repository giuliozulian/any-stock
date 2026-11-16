-- AlterTable
ALTER TABLE "DiscoveredCandidate" ADD COLUMN     "aiCheckedAt" TIMESTAMP(3),
ADD COLUMN     "aiNote" TEXT,
ADD COLUMN     "aiVerdict" TEXT;
