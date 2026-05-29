-- AlterTable
ALTER TABLE "treasury_payables" ALTER COLUMN "dueDate" DROP NOT NULL,
ALTER COLUMN "totalAmount" DROP NOT NULL,
ALTER COLUMN "paidAmount" DROP NOT NULL,
ALTER COLUMN "paidAmount" DROP DEFAULT,
ALTER COLUMN "pendingAmount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "treasury_receivables" ALTER COLUMN "dueDate" DROP NOT NULL,
ALTER COLUMN "totalAmount" DROP NOT NULL,
ALTER COLUMN "receivedAmount" DROP NOT NULL,
ALTER COLUMN "receivedAmount" DROP DEFAULT,
ALTER COLUMN "pendingAmount" DROP NOT NULL;

-- CreateTable
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
CREATE INDEX "treasury_budget_categories_clientId_type_idx" ON "treasury_budget_categories"("clientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_budget_categories_clientId_name_type_key" ON "treasury_budget_categories"("clientId", "name", "type");

-- AddForeignKey
ALTER TABLE "treasury_budget_categories" ADD CONSTRAINT "treasury_budget_categories_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
