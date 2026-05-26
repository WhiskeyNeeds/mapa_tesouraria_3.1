-- Drop a tabela antiga de junção Budget↔TreasuryCategory (sem dados úteis, está aplicada mas só foi usada
-- horas/dias). A nova feature divide claramente categorias de movimentos das categorias de budget.
DROP TABLE IF EXISTS "treasury_budget_categories" CASCADE;

-- Nova entidade: TreasuryBudgetCategory (autonoma, com clientId, name, type, color, etc.)
CREATE TABLE "treasury_budget_categories" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "TreasuryCategoryType" NOT NULL,
    "color" VARCHAR(7),
    "icon" VARCHAR(40),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_budget_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "treasury_budget_categories_clientId_name_type_key" ON "treasury_budget_categories"("clientId", "name", "type");

-- CreateIndex
CREATE INDEX "treasury_budget_categories_clientId_type_idx" ON "treasury_budget_categories"("clientId", "type");

-- AddForeignKey
ALTER TABLE "treasury_budget_categories" ADD CONSTRAINT "treasury_budget_categories_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nova tabela de junção Budget↔BudgetCategory (N:M)
CREATE TABLE "treasury_budget_category_links" (
    "budgetId" TEXT NOT NULL,
    "budgetCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_budget_category_links_pkey" PRIMARY KEY ("budgetId", "budgetCategoryId")
);

-- CreateIndex
CREATE INDEX "treasury_budget_category_links_budgetCategoryId_idx" ON "treasury_budget_category_links"("budgetCategoryId");

-- AddForeignKey
ALTER TABLE "treasury_budget_category_links" ADD CONSTRAINT "treasury_budget_category_links_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_budget_category_links" ADD CONSTRAINT "treasury_budget_category_links_budgetCategoryId_fkey" FOREIGN KEY ("budgetCategoryId") REFERENCES "treasury_budget_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Receivable: adicionar budgetCategoryId
ALTER TABLE "treasury_receivables" ADD COLUMN "budgetCategoryId" TEXT;

-- AlterTable Payable: adicionar budgetCategoryId
ALTER TABLE "treasury_payables" ADD COLUMN "budgetCategoryId" TEXT;

-- CreateIndex
CREATE INDEX "treasury_receivables_clientId_budgetCategoryId_idx" ON "treasury_receivables"("clientId", "budgetCategoryId");

-- CreateIndex
CREATE INDEX "treasury_payables_clientId_budgetCategoryId_idx" ON "treasury_payables"("clientId", "budgetCategoryId");

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_budgetCategoryId_fkey" FOREIGN KEY ("budgetCategoryId") REFERENCES "treasury_budget_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_budgetCategoryId_fkey" FOREIGN KEY ("budgetCategoryId") REFERENCES "treasury_budget_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
