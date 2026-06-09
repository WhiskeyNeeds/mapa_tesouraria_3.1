-- AlterTable: campos de exibição extraídos do raw, para a listagem ordenar/
-- filtrar/mostrar sem carregar o blob JSON inteiro.
ALTER TABLE "toc_sales_documents" ADD COLUMN "documentNo" TEXT;
ALTER TABLE "toc_sales_documents" ADD COLUMN "customerName" TEXT;

-- Backfill a partir do raw (mesmos valores que o overlay lia em runtime)
UPDATE "toc_sales_documents"
SET "documentNo"   = "raw"->>'document_no',
    "customerName" = "raw"->>'customer_business_name';
