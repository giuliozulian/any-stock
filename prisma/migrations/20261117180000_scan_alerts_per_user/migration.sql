-- Back up the database before running this: the scanner alerts become per-user and the old global rows are reassigned.

-- Existing alerts and settings belong to the original (first) Supabase user; 'dev' is the local no-login user when there is no auth schema.
ALTER TABLE "ScanAlert" ADD COLUMN "userId" TEXT, ADD COLUMN "userEmail" TEXT;
ALTER TABLE "ScannerAlertSettings" ADD COLUMN "userId" TEXT, ADD COLUMN "userEmail" TEXT;

DO $$
DECLARE
  owner_id text;
  owner_email text;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'SELECT id::text, email FROM auth.users ORDER BY created_at LIMIT 1' INTO owner_id, owner_email;
  END IF;
  UPDATE "ScanAlert" SET "userId" = COALESCE(owner_id, 'dev'), "userEmail" = owner_email;
  UPDATE "ScannerAlertSettings" SET "userId" = COALESCE(owner_id, 'dev'), "userEmail" = owner_email;
END $$;

ALTER TABLE "ScanAlert" ALTER COLUMN "userId" SET NOT NULL;
DROP INDEX "ScanAlert_symbol_key";
CREATE UNIQUE INDEX "ScanAlert_userId_symbol_key" ON "ScanAlert"("userId", "symbol");

ALTER TABLE "ScannerAlertSettings" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ScannerAlertSettings" DROP CONSTRAINT "ScannerAlertSettings_pkey";
ALTER TABLE "ScannerAlertSettings" DROP COLUMN "id";
ALTER TABLE "ScannerAlertSettings" ADD CONSTRAINT "ScannerAlertSettings_pkey" PRIMARY KEY ("userId");
