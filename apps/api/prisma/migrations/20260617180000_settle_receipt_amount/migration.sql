-- Valor do recibo (receber) / comprovativo (pagar) interno registado ao liquidar
-- manualmente = parte ainda não coberta pelo TOConline nesse momento.
ALTER TABLE "treasury_receivables" ADD COLUMN "receiptAmount" DECIMAL(18,2);
ALTER TABLE "treasury_payables" ADD COLUMN "paymentAmount" DECIMAL(18,2);
