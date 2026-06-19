-- AlterTable: coluna extraída do raw para evitar carregar o blob JSON nas listagens/KPIs
ALTER TABLE "toc_sales_documents" ADD COLUMN "documentType" TEXT;

-- Backfill: extrai document_type do raw (em minúsculas, como o código compara)
UPDATE "toc_sales_documents"
SET "documentType" = lower("raw"->>'document_type')
WHERE "raw" ? 'document_type';

-- Índices novos
CREATE INDEX "toc_sales_documents_clientId_status_idx" ON "toc_sales_documents"("clientId", "status");
CREATE INDEX "treasury_receivables_clientId_status_settledAt_idx" ON "treasury_receivables"("clientId", "status", "settledAt");
