-- AlterEnum
ALTER TYPE "TreasuryRecurrenceFrequency" ADD VALUE IF NOT EXISTS 'DAILY';
ALTER TYPE "TreasuryRecurrenceFrequency" ADD VALUE IF NOT EXISTS 'WEEKLY';

-- AlterTable treasury_receivables
ALTER TABLE "treasury_receivables"
  ALTER COLUMN "entityName" DROP NOT NULL,
  ALTER COLUMN "reference" DROP NOT NULL,
  ALTER COLUMN "documentDate" DROP NOT NULL;

-- AlterTable treasury_payables
ALTER TABLE "treasury_payables"
  ALTER COLUMN "entityName" DROP NOT NULL,
  ALTER COLUMN "reference" DROP NOT NULL,
  ALTER COLUMN "documentDate" DROP NOT NULL;
