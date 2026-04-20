-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CLIENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BalancoTipoEmpresa" AS ENUM ('MICRO', 'NORMAL_PEQUENA', 'SETOR_NAO_LUCRATIVO');

-- CreateEnum
CREATE TYPE "ToconlineStatus" AS ENUM ('UNCONFIGURED', 'PENDING_AUTH', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "TreasuryCategoryType" AS ENUM ('REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TreasuryDocOrigin" AS ENUM ('TOCONLINE', 'LOCAL');

-- CreateEnum
CREATE TYPE "TreasuryDocStatus" AS ENUM ('OPEN', 'PARTIAL', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "TreasuryMovementStatus" AS ENUM ('UNCLASSIFIED', 'CLASSIFIED', 'PARTIAL', 'RECONCILED');

-- CreateEnum
CREATE TYPE "TreasuryMovementSource" AS ENUM ('CSV_IMPORT', 'PDF_IMPORT', 'OFX_IMPORT', 'OPEN_BANKING', 'MANUAL');

-- CreateEnum
CREATE TYPE "TreasuryRecurrenceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TreasuryReconciliationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TreasuryImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'QUARANTINED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "inviteToken" TEXT,
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "inviteTokenPurpose" TEXT,
    "passwordSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nif" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyType" "BalancoTipoEmpresa" NOT NULL DEFAULT 'MICRO',
    "countryCode" TEXT NOT NULL DEFAULT 'PT',
    "nomeOficial" TEXT,
    "morada" TEXT,
    "codigoPostal" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_clients" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_clients_pkey" PRIMARY KEY ("userId","clientId")
);

-- CreateTable
CREATE TABLE "toconline_configs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "oauthUrl" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tocClientId" TEXT NOT NULL,
    "tocClientSecret" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "ToconlineStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toconline_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_categories" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "TreasuryCategoryType" NOT NULL,
    "launchToc" BOOLEAN NOT NULL DEFAULT true,
    "tocExpenseCategoryId" TEXT,
    "tocTaxDescriptorId" TEXT,
    "color" VARCHAR(7),
    "icon" VARCHAR(40),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_bank_accounts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "bankName" VARCHAR(80),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "ibanEnc" TEXT,
    "ibanLast4" VARCHAR(4),
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minBalance" DECIMAL(18,2),
    "tocBankAccountId" TEXT,
    "tocSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_bank_imports" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "source" "TreasuryMovementSource" NOT NULL,
    "originalFileName" TEXT,
    "storageKey" TEXT,
    "fileSha256" VARCHAR(64),
    "fileSize" INTEGER,
    "mimeType" VARCHAR(80),
    "status" "TreasuryImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsDuplicated" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_bank_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_bank_movements" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bookingDate" TIMESTAMP(3),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "balanceAfter" DECIMAL(18,2),
    "description" VARCHAR(500) NOT NULL,
    "normalizedDesc" VARCHAR(500),
    "counterpartName" VARCHAR(200),
    "counterpartIban" VARCHAR(50),
    "categoryId" TEXT,
    "source" "TreasuryMovementSource" NOT NULL,
    "importId" TEXT,
    "dedupeHash" VARCHAR(64) NOT NULL,
    "status" "TreasuryMovementStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "reconciledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "externalRef" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_bank_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_receivables" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "entityName" VARCHAR(200) NOT NULL,
    "entityNif" VARCHAR(20),
    "tocCustomerId" TEXT,
    "reference" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "documentDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(18,2) NOT NULL,
    "status" "TreasuryDocStatus" NOT NULL DEFAULT 'OPEN',
    "origin" "TreasuryDocOrigin" NOT NULL,
    "tocSalesDocId" TEXT,
    "tocSyncedAt" TIMESTAMP(3),
    "tocSyncError" TEXT,
    "recurrenceId" TEXT,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_payables" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "entityName" VARCHAR(200) NOT NULL,
    "entityNif" VARCHAR(20),
    "tocSupplierId" TEXT,
    "reference" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "documentDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(18,2) NOT NULL,
    "status" "TreasuryDocStatus" NOT NULL DEFAULT 'OPEN',
    "origin" "TreasuryDocOrigin" NOT NULL,
    "tocPurchasesDocId" TEXT,
    "tocSyncedAt" TIMESTAMP(3),
    "tocSyncError" TEXT,
    "recurrenceId" TEXT,
    "parentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_recurrences" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "frequency" "TreasuryRecurrenceFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "occurrences" INTEGER,
    "customRrule" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_reconciliations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "TreasuryReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "direction" "TreasuryCategoryType" NOT NULL,
    "isDryRun" BOOLEAN NOT NULL DEFAULT true,
    "totalMovements" DECIMAL(18,2) NOT NULL,
    "totalAllocated" DECIMAL(18,2) NOT NULL,
    "tocReceiptsCreated" INTEGER NOT NULL DEFAULT 0,
    "tocPaymentsCreated" INTEGER NOT NULL DEFAULT 0,
    "tocFirstError" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_reconciliation_movements" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "treasury_reconciliation_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_reconciliation_receivables" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amountAllocated" DECIMAL(18,2) NOT NULL,
    "tocReceiptId" TEXT,
    "tocCreatedAt" TIMESTAMP(3),
    "tocError" TEXT,

    CONSTRAINT "treasury_reconciliation_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_reconciliation_payables" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amountAllocated" DECIMAL(18,2) NOT NULL,
    "tocPaymentId" TEXT,
    "tocCreatedAt" TIMESTAMP(3),
    "tocError" TEXT,

    CONSTRAINT "treasury_reconciliation_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_classification_rules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "matchField" VARCHAR(20) NOT NULL,
    "matchOp" VARCHAR(20) NOT NULL,
    "matchValue" VARCHAR(500) NOT NULL,
    "amountMin" DECIMAL(18,2),
    "amountMax" DECIMAL(18,2),
    "direction" "TreasuryCategoryType",
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_classification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_settings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reconciliationDryRun" BOOLEAN NOT NULL DEFAULT true,
    "autoMatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoMatchThreshold" DECIMAL(3,2) NOT NULL DEFAULT 0.95,
    "lowBalanceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lowBalanceChannels" TEXT[],
    "importFileRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "lastFullSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_audit_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(40),
    "payload" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "app_roles_name_key" ON "app_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_nif_key" ON "clients"("nif");

-- CreateIndex
CREATE INDEX "clients_isActive_idx" ON "clients"("isActive");

-- CreateIndex
CREATE INDEX "clients_nif_idx" ON "clients"("nif");

-- CreateIndex
CREATE UNIQUE INDEX "toconline_configs_clientId_key" ON "toconline_configs"("clientId");

-- CreateIndex
CREATE INDEX "treasury_categories_clientId_type_idx" ON "treasury_categories"("clientId", "type");

-- CreateIndex
CREATE INDEX "treasury_categories_clientId_launchToc_idx" ON "treasury_categories"("clientId", "launchToc");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_categories_clientId_name_key" ON "treasury_categories"("clientId", "name");

-- CreateIndex
CREATE INDEX "treasury_bank_accounts_clientId_isActive_idx" ON "treasury_bank_accounts"("clientId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_bank_accounts_clientId_tocBankAccountId_key" ON "treasury_bank_accounts"("clientId", "tocBankAccountId");

-- CreateIndex
CREATE INDEX "treasury_bank_imports_clientId_bankAccountId_createdAt_idx" ON "treasury_bank_imports"("clientId", "bankAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_bank_imports_fileSha256_idx" ON "treasury_bank_imports"("fileSha256");

-- CreateIndex
CREATE INDEX "treasury_bank_movements_clientId_bankAccountId_date_idx" ON "treasury_bank_movements"("clientId", "bankAccountId", "date" DESC);

-- CreateIndex
CREATE INDEX "treasury_bank_movements_clientId_status_idx" ON "treasury_bank_movements"("clientId", "status");

-- CreateIndex
CREATE INDEX "treasury_bank_movements_clientId_categoryId_idx" ON "treasury_bank_movements"("clientId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_bank_movements_clientId_dedupeHash_key" ON "treasury_bank_movements"("clientId", "dedupeHash");

-- CreateIndex
CREATE INDEX "treasury_receivables_clientId_status_dueDate_idx" ON "treasury_receivables"("clientId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "treasury_receivables_clientId_categoryId_idx" ON "treasury_receivables"("clientId", "categoryId");

-- CreateIndex
CREATE INDEX "treasury_receivables_clientId_origin_idx" ON "treasury_receivables"("clientId", "origin");

-- CreateIndex
CREATE INDEX "treasury_receivables_tocSalesDocId_idx" ON "treasury_receivables"("tocSalesDocId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_receivables_clientId_reference_key" ON "treasury_receivables"("clientId", "reference");

-- CreateIndex
CREATE INDEX "treasury_payables_clientId_status_dueDate_idx" ON "treasury_payables"("clientId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "treasury_payables_clientId_categoryId_idx" ON "treasury_payables"("clientId", "categoryId");

-- CreateIndex
CREATE INDEX "treasury_payables_clientId_origin_idx" ON "treasury_payables"("clientId", "origin");

-- CreateIndex
CREATE INDEX "treasury_payables_tocPurchasesDocId_idx" ON "treasury_payables"("tocPurchasesDocId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_payables_clientId_reference_key" ON "treasury_payables"("clientId", "reference");

-- CreateIndex
CREATE INDEX "treasury_recurrences_clientId_isActive_nextRunAt_idx" ON "treasury_recurrences"("clientId", "isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "treasury_reconciliations_clientId_status_createdAt_idx" ON "treasury_reconciliations"("clientId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_reconciliations_clientId_createdById_idx" ON "treasury_reconciliations"("clientId", "createdById");

-- CreateIndex
CREATE INDEX "treasury_reconciliation_movements_movementId_idx" ON "treasury_reconciliation_movements"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_reconciliation_movements_reconciliationId_movement_key" ON "treasury_reconciliation_movements"("reconciliationId", "movementId");

-- CreateIndex
CREATE INDEX "treasury_reconciliation_receivables_receivableId_idx" ON "treasury_reconciliation_receivables"("receivableId");

-- CreateIndex
CREATE INDEX "treasury_reconciliation_receivables_tocReceiptId_idx" ON "treasury_reconciliation_receivables"("tocReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_reconciliation_receivables_reconciliationId_receiv_key" ON "treasury_reconciliation_receivables"("reconciliationId", "receivableId");

-- CreateIndex
CREATE INDEX "treasury_reconciliation_payables_payableId_idx" ON "treasury_reconciliation_payables"("payableId");

-- CreateIndex
CREATE INDEX "treasury_reconciliation_payables_tocPaymentId_idx" ON "treasury_reconciliation_payables"("tocPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_reconciliation_payables_reconciliationId_payableId_key" ON "treasury_reconciliation_payables"("reconciliationId", "payableId");

-- CreateIndex
CREATE INDEX "treasury_classification_rules_clientId_isActive_priority_idx" ON "treasury_classification_rules"("clientId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_settings_clientId_key" ON "treasury_settings"("clientId");

-- CreateIndex
CREATE INDEX "treasury_audit_logs_clientId_createdAt_idx" ON "treasury_audit_logs"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_audit_logs_clientId_action_idx" ON "treasury_audit_logs"("clientId", "action");

-- CreateIndex
CREATE INDEX "treasury_audit_logs_entityType_entityId_idx" ON "treasury_audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "app_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toconline_configs" ADD CONSTRAINT "toconline_configs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_categories" ADD CONSTRAINT "treasury_categories_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_accounts" ADD CONSTRAINT "treasury_bank_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_imports" ADD CONSTRAINT "treasury_bank_imports_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_imports" ADD CONSTRAINT "treasury_bank_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "treasury_bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_imports" ADD CONSTRAINT "treasury_bank_imports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_movements" ADD CONSTRAINT "treasury_bank_movements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_movements" ADD CONSTRAINT "treasury_bank_movements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "treasury_bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_movements" ADD CONSTRAINT "treasury_bank_movements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_bank_movements" ADD CONSTRAINT "treasury_bank_movements_importId_fkey" FOREIGN KEY ("importId") REFERENCES "treasury_bank_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "treasury_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "treasury_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "treasury_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "treasury_payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_recurrences" ADD CONSTRAINT "treasury_recurrences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliations" ADD CONSTRAINT "treasury_reconciliations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliations" ADD CONSTRAINT "treasury_reconciliations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliations" ADD CONSTRAINT "treasury_reconciliations_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_movements" ADD CONSTRAINT "treasury_reconciliation_movements_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "treasury_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_movements" ADD CONSTRAINT "treasury_reconciliation_movements_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "treasury_bank_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_receivables" ADD CONSTRAINT "treasury_reconciliation_receivables_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "treasury_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_receivables" ADD CONSTRAINT "treasury_reconciliation_receivables_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "treasury_receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_payables" ADD CONSTRAINT "treasury_reconciliation_payables_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "treasury_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_reconciliation_payables" ADD CONSTRAINT "treasury_reconciliation_payables_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "treasury_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_classification_rules" ADD CONSTRAINT "treasury_classification_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_classification_rules" ADD CONSTRAINT "treasury_classification_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_settings" ADD CONSTRAINT "treasury_settings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_audit_logs" ADD CONSTRAINT "treasury_audit_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_audit_logs" ADD CONSTRAINT "treasury_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
