-- 1. Criar nova tabela de regras de budget
CREATE TABLE "treasury_budget_rules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "textPattern" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_budget_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "treasury_budget_rules_clientId_budgetId_idx" ON "treasury_budget_rules"("clientId", "budgetId");
CREATE INDEX "treasury_budget_rules_clientId_categoryId_idx" ON "treasury_budget_rules"("clientId", "categoryId");
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Adicionar budgetAutoAssigned às tabelas de receivables e payables
ALTER TABLE "treasury_receivables" ADD COLUMN "budgetAutoAssigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "treasury_payables" ADD COLUMN "budgetAutoAssigned" BOOLEAN NOT NULL DEFAULT false;

-- 3. Remover índices sobre budgetCategoryId antes de remover colunas
DROP INDEX IF EXISTS "treasury_receivables_clientId_budgetCategoryId_idx";
DROP INDEX IF EXISTS "treasury_payables_clientId_budgetCategoryId_idx";

-- 4. Remover as foreign keys de budgetCategoryId
ALTER TABLE "treasury_receivables" DROP CONSTRAINT IF EXISTS "treasury_receivables_budgetCategoryId_fkey";
ALTER TABLE "treasury_payables" DROP CONSTRAINT IF EXISTS "treasury_payables_budgetCategoryId_fkey";

-- 5. Remover colunas budgetCategoryId
ALTER TABLE "treasury_receivables" DROP COLUMN IF EXISTS "budgetCategoryId";
ALTER TABLE "treasury_payables" DROP COLUMN IF EXISTS "budgetCategoryId";

-- 6. Remover tabelas antigas (a de links primeiro por causa da FK)
DROP TABLE IF EXISTS "treasury_budget_category_links";
DROP TABLE IF EXISTS "treasury_budget_categories";
