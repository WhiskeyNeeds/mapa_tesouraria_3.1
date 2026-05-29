-- Regras de cobrança / dunning: enviam lembretes automáticos baseados na data de vencimento

-- CreateTable
CREATE TABLE "treasury_dunning_rules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "direction" "TreasuryFollowupDirection" NOT NULL DEFAULT 'RECEIVABLE',
    "emailTemplateId" TEXT,
    "minAmount" DECIMAL(18,2),
    "maxAmount" DECIMAL(18,2),
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "lastExecutedAt" TIMESTAMP(3),
    "totalExecutions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_dunning_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treasury_dunning_rules_clientId_isActive_offsetDays_idx" ON "treasury_dunning_rules"("clientId", "isActive", "offsetDays");

-- CreateIndex
CREATE INDEX "treasury_dunning_rules_clientId_direction_idx" ON "treasury_dunning_rules"("clientId", "direction");

-- AddForeignKey
ALTER TABLE "treasury_dunning_rules" ADD CONSTRAINT "treasury_dunning_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_dunning_rules" ADD CONSTRAINT "treasury_dunning_rules_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "treasury_email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_dunning_rules" ADD CONSTRAINT "treasury_dunning_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: execução / histórico (garante idempotência)
CREATE TABLE "treasury_dunning_executions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_dunning_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotência: uma regra por fatura)
CREATE UNIQUE INDEX "treasury_dunning_executions_ruleId_receivableId_key" ON "treasury_dunning_executions"("ruleId", "receivableId");
CREATE UNIQUE INDEX "treasury_dunning_executions_ruleId_payableId_key" ON "treasury_dunning_executions"("ruleId", "payableId");

-- CreateIndex
CREATE INDEX "treasury_dunning_executions_clientId_status_scheduledAt_idx" ON "treasury_dunning_executions"("clientId", "status", "scheduledAt");
CREATE INDEX "treasury_dunning_executions_receivableId_idx" ON "treasury_dunning_executions"("receivableId");
CREATE INDEX "treasury_dunning_executions_payableId_idx" ON "treasury_dunning_executions"("payableId");

-- AddForeignKey
ALTER TABLE "treasury_dunning_executions" ADD CONSTRAINT "treasury_dunning_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "treasury_dunning_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_dunning_executions" ADD CONSTRAINT "treasury_dunning_executions_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "treasury_receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_dunning_executions" ADD CONSTRAINT "treasury_dunning_executions_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "treasury_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
