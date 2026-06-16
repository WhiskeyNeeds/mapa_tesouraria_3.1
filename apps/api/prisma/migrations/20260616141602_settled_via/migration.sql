-- CreateEnum
CREATE TYPE "TreasurySettlementSource" AS ENUM ('LOCAL', 'INSTALLMENTS', 'RECONCILIATION');

-- AlterTable
ALTER TABLE "treasury_payables" ADD COLUMN     "settledVia" "TreasurySettlementSource";

-- AlterTable
ALTER TABLE "treasury_receivables" ADD COLUMN     "settledVia" "TreasurySettlementSource";

-- Backfill: mães divididas (têm filhos não-recorrentes) -> INSTALLMENTS
UPDATE "treasury_receivables" p SET "settledVia" = 'INSTALLMENTS'
WHERE p."status" IN ('PAID','SETTLED') AND EXISTS (
  SELECT 1 FROM "treasury_receivables" c
  WHERE c."parentId" = p."id" AND c."recurrenceId" IS NULL AND c."deletedAt" IS NULL
);
UPDATE "treasury_payables" p SET "settledVia" = 'INSTALLMENTS'
WHERE p."status" IN ('PAID','SETTLED') AND EXISTS (
  SELECT 1 FROM "treasury_payables" c
  WHERE c."parentId" = p."id" AND c."recurrenceId" IS NULL AND c."deletedAt" IS NULL
);

-- Backfill: docs fechados com reconciliação confirmada -> RECONCILIATION
UPDATE "treasury_receivables" r SET "settledVia" = 'RECONCILIATION'
WHERE r."status" IN ('PAID','SETTLED') AND r."settledVia" IS NULL AND EXISTS (
  SELECT 1 FROM "treasury_reconciliation_receivables" l
  JOIN "treasury_reconciliations" rec ON rec."id" = l."reconciliationId"
  WHERE l."receivableId" = r."id" AND rec."status" = 'CONFIRMED'
);
UPDATE "treasury_payables" pay SET "settledVia" = 'RECONCILIATION'
WHERE pay."status" IN ('PAID','SETTLED') AND pay."settledVia" IS NULL AND EXISTS (
  SELECT 1 FROM "treasury_reconciliation_payables" l
  JOIN "treasury_reconciliations" rec ON rec."id" = l."reconciliationId"
  WHERE l."payableId" = pay."id" AND rec."status" = 'CONFIRMED'
);

-- Backfill: restantes fechados -> LOCAL
UPDATE "treasury_receivables" SET "settledVia" = 'LOCAL'
WHERE "status" IN ('PAID','SETTLED') AND "settledVia" IS NULL;
UPDATE "treasury_payables" SET "settledVia" = 'LOCAL'
WHERE "status" IN ('PAID','SETTLED') AND "settledVia" IS NULL;
