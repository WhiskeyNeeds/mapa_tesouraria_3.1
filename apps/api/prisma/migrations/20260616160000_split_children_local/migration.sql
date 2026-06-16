-- Abordagem A: parcelas (filhos não-recorrentes) deixam de herdar a ligação ao
-- TOConline da fatura-mãe. Limpa o vínculo em parcelas já existentes para que o
-- overlay TOC deixe de as reescrever com o nº/valor da fatura inteira — passam a
-- mostrar a sua referência sufixada (-1, -2…) e o seu valor próprio (já gravados
-- localmente no split). A fatura-mãe mantém a sua ligação ao TOConline.
UPDATE "treasury_receivables"
SET "tocSalesDocId" = NULL
WHERE "parentId" IS NOT NULL AND "recurrenceId" IS NULL AND "tocSalesDocId" IS NOT NULL;

UPDATE "treasury_payables"
SET "tocPurchasesDocId" = NULL
WHERE "parentId" IS NOT NULL AND "recurrenceId" IS NULL AND "tocPurchasesDocId" IS NOT NULL;
