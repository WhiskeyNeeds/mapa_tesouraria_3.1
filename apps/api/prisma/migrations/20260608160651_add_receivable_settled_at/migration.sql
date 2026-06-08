-- AlterTable
ALTER TABLE "treasury_receivables" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- Backfill: para os documentos já liquidados, aproxima a data de liquidação
-- pelo updatedAt (sinal histórico usado antes desta coluna existir).
UPDATE "treasury_receivables"
SET "settledAt" = "updatedAt"
WHERE "status" IN ('PAID', 'SETTLED') AND "settledAt" IS NULL;
