CREATE TABLE "treasury_entity_configs" (
  "id"                TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "entityType"        TEXT NOT NULL,
  "tocEntityId"       TEXT NOT NULL,
  "defaultCategoryId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_entity_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_entity_configs_clientId_entityType_tocEntityId_key"
    UNIQUE ("clientId", "entityType", "tocEntityId"),
  CONSTRAINT "treasury_entity_configs_defaultCategoryId_fkey"
    FOREIGN KEY ("defaultCategoryId") REFERENCES "treasury_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
