-- AlterTable
ALTER TABLE "MoveExplanation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ai',
ADD COLUMN     "sources" JSONB NOT NULL DEFAULT '[]';
