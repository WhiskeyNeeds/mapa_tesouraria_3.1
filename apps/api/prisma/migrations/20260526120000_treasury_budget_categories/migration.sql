-- CreateTable
CREATE TABLE "treasury_budget_categories" (
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_budget_categories_pkey" PRIMARY KEY ("budgetId", "categoryId")
);

-- CreateIndex
CREATE INDEX "treasury_budget_categories_categoryId_idx" ON "treasury_budget_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "treasury_budget_categories" ADD CONSTRAINT "treasury_budget_categories_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_budget_categories" ADD CONSTRAINT "treasury_budget_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
