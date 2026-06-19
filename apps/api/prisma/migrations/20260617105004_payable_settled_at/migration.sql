-- AlterTable
ALTER TABLE "treasury_payables" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- Backfill: para payables já pagos/liquidados, a data real de pagamento não foi
-- registada historicamente. Aproxima-se com updatedAt (instante da última
-- alteração, normalmente o momento em que foi marcado pago). Apenas como ponto
-- de partida; novos pagamentos passam a gravar settledAt = momento do pagamento.
UPDATE "treasury_payables"
SET "settledAt" = "updatedAt"
WHERE "status" IN ('PAID', 'SETTLED') AND "settledAt" IS NULL;
