-- Drop the full unique constraint on dedupeHash
-- Soft-deleted records were blocking re-imports of the same data
DROP INDEX IF EXISTS "treasury_bank_movements_clientId_dedupeHash_key";

-- Create a partial unique index: uniqueness is only enforced on active (non-deleted) records
-- This allows the same dedupeHash to exist in soft-deleted rows without blocking new imports
CREATE UNIQUE INDEX "treasury_bank_movements_clientId_dedupeHash_active_key"
ON "treasury_bank_movements"("clientId", "dedupeHash")
WHERE "deletedAt" IS NULL;
