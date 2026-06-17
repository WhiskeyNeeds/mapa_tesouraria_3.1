-- Normaliza documentos em "limbo": criados localmente com uma categoria antiga
-- de `launchToc=true` ficaram com origin='TOCONLINE' apesar de nunca terem sido
-- associados a um documento TOConline (tocSalesDocId/tocPurchasesDocId NULL).
-- O `launchToc` está descontinuado (a app já não escreve no TOC), por isso a
-- origem passa a refletir apenas a ligação efetiva ao TOConline.

UPDATE "treasury_receivables"
SET "origin" = 'LOCAL'
WHERE "origin" = 'TOCONLINE' AND "tocSalesDocId" IS NULL;

UPDATE "treasury_payables"
SET "origin" = 'LOCAL'
WHERE "origin" = 'TOCONLINE' AND "tocPurchasesDocId" IS NULL;
