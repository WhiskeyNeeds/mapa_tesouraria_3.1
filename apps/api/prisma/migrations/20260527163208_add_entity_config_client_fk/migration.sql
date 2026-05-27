-- CreateIndex
CREATE INDEX "treasury_entity_configs_clientId_idx" ON "treasury_entity_configs"("clientId");

-- AddForeignKey
ALTER TABLE "treasury_entity_configs" ADD CONSTRAINT "treasury_entity_configs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
