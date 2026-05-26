-- CreateEnum
CREATE TYPE "TreasuryFollowupKind" AS ENUM ('EMAIL_SENT', 'CALL_TASK', 'CALL_LOGGED', 'NOTE', 'AUTO_REMINDER');

-- CreateEnum
CREATE TYPE "TreasuryFollowupStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TreasuryFollowupImportance" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "TreasuryFollowupDirection" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "TreasuryEmailTemplateScope" AS ENUM ('RECEIVABLE', 'PAYABLE', 'BOTH');

-- DropForeignKey
ALTER TABLE "treasury_budgets" DROP CONSTRAINT "treasury_budgets_createdById_fkey";

-- DropForeignKey
ALTER TABLE "treasury_payables" DROP CONSTRAINT "treasury_payables_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "treasury_receivables" DROP CONSTRAINT "treasury_receivables_categoryId_fkey";

-- AlterTable
ALTER TABLE "treasury_settings" ADD COLUMN     "followupEnableCallTask" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followupEnableEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followupEnableLogCall" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followupEnableNote" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followupEnablePdfUpload" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "treasury_email_templates" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scope" "TreasuryEmailTemplateScope" NOT NULL DEFAULT 'BOTH',
    "subject" VARCHAR(300) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_followups" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" "TreasuryFollowupDirection" NOT NULL,
    "kind" "TreasuryFollowupKind" NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "status" "TreasuryFollowupStatus" NOT NULL DEFAULT 'DONE',
    "importance" "TreasuryFollowupImportance" NOT NULL DEFAULT 'NORMAL',
    "title" VARCHAR(300),
    "description" TEXT,
    "payload" JSONB,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_invoice_attachments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "filename" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_invoice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treasury_email_templates_clientId_scope_isActive_idx" ON "treasury_email_templates"("clientId", "scope", "isActive");

-- CreateIndex
CREATE INDEX "treasury_followups_clientId_createdAt_idx" ON "treasury_followups"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_followups_receivableId_createdAt_idx" ON "treasury_followups"("receivableId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_followups_payableId_createdAt_idx" ON "treasury_followups"("payableId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_followups_clientId_kind_status_idx" ON "treasury_followups"("clientId", "kind", "status");

-- CreateIndex
CREATE INDEX "treasury_followups_assignedToId_status_dueAt_idx" ON "treasury_followups"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "treasury_invoice_attachments_clientId_createdAt_idx" ON "treasury_invoice_attachments"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "treasury_invoice_attachments_receivableId_idx" ON "treasury_invoice_attachments"("receivableId");

-- CreateIndex
CREATE INDEX "treasury_invoice_attachments_payableId_idx" ON "treasury_invoice_attachments"("payableId");

-- AddForeignKey
ALTER TABLE "treasury_receivables" ADD CONSTRAINT "treasury_receivables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_payables" ADD CONSTRAINT "treasury_payables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_email_templates" ADD CONSTRAINT "treasury_email_templates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_email_templates" ADD CONSTRAINT "treasury_email_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_followups" ADD CONSTRAINT "treasury_followups_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_followups" ADD CONSTRAINT "treasury_followups_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "treasury_receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_followups" ADD CONSTRAINT "treasury_followups_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "treasury_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_followups" ADD CONSTRAINT "treasury_followups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_followups" ADD CONSTRAINT "treasury_followups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_invoice_attachments" ADD CONSTRAINT "treasury_invoice_attachments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_invoice_attachments" ADD CONSTRAINT "treasury_invoice_attachments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "treasury_receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_invoice_attachments" ADD CONSTRAINT "treasury_invoice_attachments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "treasury_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_invoice_attachments" ADD CONSTRAINT "treasury_invoice_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_budgets" ADD CONSTRAINT "treasury_budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
