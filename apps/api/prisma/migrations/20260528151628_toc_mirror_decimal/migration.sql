/*
  Warnings:

  - You are about to alter the column `unitPrice` on the `toc_products` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,4)`.
  - You are about to alter the column `taxRate` on the `toc_products` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(5,2)`.
  - You are about to alter the column `grossTotal` on the `toc_purchase_documents` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `pendingTotal` on the `toc_purchase_documents` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `grossTotal` on the `toc_purchase_payments` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `grossTotal` on the `toc_sales_documents` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `pendingTotal` on the `toc_sales_documents` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `grossTotal` on the `toc_sales_receipts` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,2)`.
  - You are about to alter the column `unitPrice` on the `toc_services` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(18,4)`.
  - You are about to alter the column `taxRate` on the `toc_services` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(5,2)`.
  - Added the required column `updatedAt` to the `toc_sync_state` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "toc_products" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "taxRate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "toc_purchase_documents" ALTER COLUMN "grossTotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "pendingTotal" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "toc_purchase_payments" ALTER COLUMN "grossTotal" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "toc_sales_documents" ALTER COLUMN "grossTotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "pendingTotal" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "toc_sales_receipts" ALTER COLUMN "grossTotal" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "toc_services" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "taxRate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "toc_sync_state" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
