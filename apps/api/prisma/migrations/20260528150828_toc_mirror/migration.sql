-- CreateTable
CREATE TABLE "toc_customers" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nif" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_suppliers" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nif" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_products" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION,
    "taxRate" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_services" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION,
    "taxRate" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_sales_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "date" TEXT,
    "dueDate" TEXT,
    "status" INTEGER,
    "grossTotal" DOUBLE PRECISION,
    "pendingTotal" DOUBLE PRECISION,
    "receiptsIds" INTEGER[],
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_purchase_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "date" TEXT,
    "dueDate" TEXT,
    "status" INTEGER,
    "grossTotal" DOUBLE PRECISION,
    "pendingTotal" DOUBLE PRECISION,
    "paymentsIds" INTEGER[],
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_purchase_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_sales_receipts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "date" TEXT,
    "grossTotal" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_sales_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_purchase_payments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tocId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "date" TEXT,
    "grossTotal" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toc_purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_sync_state" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "recordCount" INTEGER,

    CONSTRAINT "toc_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "toc_customers_clientId_idx" ON "toc_customers"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_customers_clientId_tocId_key" ON "toc_customers"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_suppliers_clientId_idx" ON "toc_suppliers"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_suppliers_clientId_tocId_key" ON "toc_suppliers"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_products_clientId_idx" ON "toc_products"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_products_clientId_tocId_key" ON "toc_products"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_services_clientId_idx" ON "toc_services"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_services_clientId_tocId_key" ON "toc_services"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_sales_documents_clientId_customerId_idx" ON "toc_sales_documents"("clientId", "customerId");

-- CreateIndex
CREATE INDEX "toc_sales_documents_clientId_date_idx" ON "toc_sales_documents"("clientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "toc_sales_documents_clientId_tocId_key" ON "toc_sales_documents"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_purchase_documents_clientId_supplierId_idx" ON "toc_purchase_documents"("clientId", "supplierId");

-- CreateIndex
CREATE INDEX "toc_purchase_documents_clientId_date_idx" ON "toc_purchase_documents"("clientId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "toc_purchase_documents_clientId_tocId_key" ON "toc_purchase_documents"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_sales_receipts_clientId_customerId_idx" ON "toc_sales_receipts"("clientId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_sales_receipts_clientId_tocId_key" ON "toc_sales_receipts"("clientId", "tocId");

-- CreateIndex
CREATE INDEX "toc_purchase_payments_clientId_supplierId_idx" ON "toc_purchase_payments"("clientId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_purchase_payments_clientId_tocId_key" ON "toc_purchase_payments"("clientId", "tocId");

-- CreateIndex
CREATE UNIQUE INDEX "toc_sync_state_clientId_entityType_key" ON "toc_sync_state"("clientId", "entityType");
