-- CreateTable
CREATE TABLE "product_analytics" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemType" VARCHAR(20) NOT NULL,
    "entries" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_analytics_clientId_itemId_itemType_key" ON "product_analytics"("clientId", "itemId", "itemType");

-- AddForeignKey
ALTER TABLE "product_analytics" ADD CONSTRAINT "product_analytics_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
