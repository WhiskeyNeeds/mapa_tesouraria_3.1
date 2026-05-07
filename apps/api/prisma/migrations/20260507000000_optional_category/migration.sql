-- AlterTable: make categoryId optional on receivables and payables
ALTER TABLE "treasury_receivables" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "treasury_payables" ALTER COLUMN "categoryId" DROP NOT NULL;
