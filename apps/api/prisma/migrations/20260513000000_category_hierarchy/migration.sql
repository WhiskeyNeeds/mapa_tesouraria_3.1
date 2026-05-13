-- Add parentId for category hierarchy (self-relation)
ALTER TABLE "treasury_categories" ADD COLUMN "parentId" TEXT;

-- Add FK constraint (SET NULL on delete so removing a parent doesn't cascade-delete children)
ALTER TABLE "treasury_categories"
  ADD CONSTRAINT "treasury_categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "treasury_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for parent lookups
CREATE INDEX "treasury_categories_clientId_parentId_idx" ON "treasury_categories"("clientId", "parentId");

-- Update unique constraint: allow same name if type differs (e.g. "Operating flows" REVENUE vs EXPENSE)
DROP INDEX IF EXISTS "treasury_categories_clientId_name_key";
CREATE UNIQUE INDEX "treasury_categories_clientId_name_type_key" ON "treasury_categories"("clientId", "name", "type");
