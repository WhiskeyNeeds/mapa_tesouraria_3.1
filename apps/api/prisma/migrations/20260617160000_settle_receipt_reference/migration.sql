-- Referência do recibo (receber) / comprovativo de pagamento (pagar) registada
-- manualmente ao liquidar (PAID -> SETTLED). A data do recibo/pagamento é
-- guardada em `settledAt`. Ambas limpas ao reverter a liquidação.
ALTER TABLE "treasury_receivables" ADD COLUMN "receiptReference" VARCHAR(80);
ALTER TABLE "treasury_payables" ADD COLUMN "paymentReference" VARCHAR(80);
