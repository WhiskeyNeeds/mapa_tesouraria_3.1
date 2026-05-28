-- Réguas de cobrança: nova hierarquia Track → Rules.
-- Decisão do utilizador: regras existentes são apagadas — começa-se do zero.

-- 1) Limpa execuções e regras existentes (não há FK constraints para limpar antes,
--    além das que estão em CASCADE)
DELETE FROM "treasury_dunning_executions";
DELETE FROM "treasury_dunning_rules";

-- 2) Cria a tabela de réguas
CREATE TABLE "treasury_dunning_tracks" (
    "id"        TEXT NOT NULL,
    "clientId"  TEXT NOT NULL,
    "name"      VARCHAR(120) NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "treasury_dunning_tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treasury_dunning_tracks_clientId_name_key"
    ON "treasury_dunning_tracks"("clientId", "name");

CREATE INDEX "treasury_dunning_tracks_clientId_isActive_idx"
    ON "treasury_dunning_tracks"("clientId", "isActive");

ALTER TABLE "treasury_dunning_tracks"
    ADD CONSTRAINT "treasury_dunning_tracks_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Cria a tabela de atribuições (cliente TOC → régua)
CREATE TABLE "treasury_dunning_track_assignments" (
    "id"            TEXT NOT NULL,
    "clientId"      TEXT NOT NULL,
    "tocCustomerId" TEXT NOT NULL,
    "trackId"       TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_dunning_track_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treasury_dunning_track_assignments_clientId_tocCustomerId_key"
    ON "treasury_dunning_track_assignments"("clientId", "tocCustomerId");

CREATE INDEX "treasury_dunning_track_assignments_trackId_idx"
    ON "treasury_dunning_track_assignments"("trackId");

ALTER TABLE "treasury_dunning_track_assignments"
    ADD CONSTRAINT "treasury_dunning_track_assignments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "treasury_dunning_track_assignments"
    ADD CONSTRAINT "treasury_dunning_track_assignments_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "treasury_dunning_tracks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Adiciona trackId às regras (já vazias, podemos pôr NOT NULL directo)
ALTER TABLE "treasury_dunning_rules" ADD COLUMN "trackId" TEXT NOT NULL;

ALTER TABLE "treasury_dunning_rules"
    ADD CONSTRAINT "treasury_dunning_rules_trackId_fkey"
    FOREIGN KEY ("trackId") REFERENCES "treasury_dunning_tracks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "treasury_dunning_rules_trackId_isActive_offsetDays_idx"
    ON "treasury_dunning_rules"("trackId", "isActive", "offsetDays");
