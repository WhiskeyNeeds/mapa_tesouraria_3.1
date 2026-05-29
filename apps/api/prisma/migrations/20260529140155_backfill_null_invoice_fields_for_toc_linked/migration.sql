-- Backfill: para receivables/payables ligados a um documento TOC (via
-- tocSalesDocId / tocPurchasesDocId), os campos da fatura passam a viver
-- apenas no espelho tocSalesDocument / tocPurchaseDocument. Aqui apagamos
-- os valores duplicados que vinham do fluxo "Importar do TOConline" para
-- evitar divergência silenciosa quando o doc é actualizado no TOC.
--
-- Campos preservados (anotações locais):
--   categoryId, budgetId, budgetAutoAssigned, recurrenceId, parentId,
--   promisedPaymentDate, description (nota livre), tocSalesDocId/tocPurchasesDocId,
--   createdById, status (mantém-se mas é sobreposto na leitura), origin
--
-- Campos nullificados (passam a vir do tocSalesDocument):
--   entityName, entityNif, tocCustomerId/tocSupplierId, reference, documentDate,
--   dueDate, totalAmount, pendingAmount, receivedAmount/paidAmount

UPDATE "treasury_receivables"
SET
  "entityName"     = NULL,
  "entityNif"      = NULL,
  "tocCustomerId"  = NULL,
  "reference"      = NULL,
  "documentDate"   = NULL,
  "dueDate"        = NULL,
  "totalAmount"    = NULL,
  "pendingAmount"  = NULL,
  "receivedAmount" = NULL
WHERE "tocSalesDocId" IS NOT NULL
  AND "deletedAt" IS NULL;

UPDATE "treasury_payables"
SET
  "entityName"    = NULL,
  "entityNif"     = NULL,
  "tocSupplierId" = NULL,
  "reference"     = NULL,
  "documentDate"  = NULL,
  "dueDate"       = NULL,
  "totalAmount"   = NULL,
  "pendingAmount" = NULL,
  "paidAmount"    = NULL
WHERE "tocPurchasesDocId" IS NOT NULL
  AND "deletedAt" IS NULL;
