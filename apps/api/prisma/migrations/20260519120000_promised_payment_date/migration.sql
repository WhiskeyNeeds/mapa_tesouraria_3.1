ALTER TABLE "treasury_receivables" ADD COLUMN IF NOT EXISTS "promisedPaymentDate" TIMESTAMP(3);
ALTER TABLE "treasury_payables"    ADD COLUMN IF NOT EXISTS "promisedPaymentDate" TIMESTAMP(3);
