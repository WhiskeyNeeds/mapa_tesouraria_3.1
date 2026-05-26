-- CreateEnum
CREATE TYPE "TreasuryBudgetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "treasury_budgets" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "TreasuryCategoryType" NOT NULL,
    "status" "TreasuryBudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "color" VARCHAR(7),
    "icon" VARCHAR(40),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treasury_budgets_clientId_status_startDate_idx" ON "treasury_budgets"("clientId", "status", "startDate");

-- CreateIndex
CREATE INDEX "treasury_budgets_clientId_type_idx" ON "treasury_budgets"("clientId", "type");

-- AddForeignKey
ALTER TABLE "treasury_budgets" ADD CONSTRAINT "treasury_budgets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_budgets" ADD CONSTRAINT "treasury_budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AlterTable Receivable
ALTER TABLE "treasury_receivables" ADD COLUMN "budgetId" TEXT;

-- AlterTable Payable
ALTER TABLE "treasury_payables" ADD COLUMN "budgetId" TEXT;

-- CreateIndex
CREATE INDEX "treasury_receivables_clientId_budgetId_idx" ON "treasury_receivables"("clientId", "budgetId");

-- CreateIndex
CREATE INDEX "treasury_payables_clientId_budgetId_idx" ON "treasury_payables"("clientId", "budgetId");

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
