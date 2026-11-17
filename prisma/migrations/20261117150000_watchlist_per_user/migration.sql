-- Back up the database before running this: it moves the per-user columns off "Stock" and drops them.

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "stockId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryPrice" DOUBLE PRECISION,
    "sellPrice" DOUBLE PRECISION,
    "entryTriggeredAt" TIMESTAMP(3),
    "sellTriggeredAt" TIMESTAMP(3),

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_userId_stockId_key" ON "WatchlistEntry"("userId", "stockId");

-- CreateIndex
CREATE INDEX "WatchlistEntry_stockId_idx" ON "WatchlistEntry"("stockId");

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing stock belongs to the original (first) Supabase user; 'dev' is the local no-login user when there is no auth schema.
DO $$
DECLARE
  owner_id text;
  owner_email text;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'SELECT id::text, email FROM auth.users ORDER BY created_at LIMIT 1' INTO owner_id, owner_email;
  END IF;
  INSERT INTO "WatchlistEntry" ("id", "userId", "userEmail", "stockId", "addedAt", "entryPrice", "sellPrice", "entryTriggeredAt", "sellTriggeredAt")
  SELECT 'wl_' || s."id", COALESCE(owner_id, 'dev'), owner_email, s."id", s."addedAt", s."entryPrice", s."sellPrice", s."entryTriggeredAt", s."sellTriggeredAt"
  FROM "Stock" s;
END $$;

-- The per-user columns leave "Stock"; "addedAt" stays as the time the stock first entered anyone's list.
ALTER TABLE "Stock" RENAME COLUMN "addedAt" TO "createdAt";
ALTER TABLE "Stock" DROP COLUMN "entryPrice", DROP COLUMN "sellPrice", DROP COLUMN "entryTriggeredAt", DROP COLUMN "sellTriggeredAt";
