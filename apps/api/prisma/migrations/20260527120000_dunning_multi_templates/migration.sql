-- Dunning rules: passar de 1 template (FK simples) para 1-3 templates (M2M).
-- A seleção do template a usar ao disparar passa a ser aleatória entre os associados.

-- 1) Cria a tabela de junção
CREATE TABLE "treasury_dunning_rule_templates" (
    "ruleId"     TEXT NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "treasury_dunning_rule_templates_pkey" PRIMARY KEY ("ruleId", "templateId")
);

CREATE INDEX "treasury_dunning_rule_templates_templateId_idx"
    ON "treasury_dunning_rule_templates"("templateId");

ALTER TABLE "treasury_dunning_rule_templates"
    ADD CONSTRAINT "treasury_dunning_rule_templates_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "treasury_dunning_rules"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "treasury_dunning_rule_templates"
    ADD CONSTRAINT "treasury_dunning_rule_templates_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "treasury_email_templates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Migra associações single → join row (preserva regras existentes)
INSERT INTO "treasury_dunning_rule_templates" ("ruleId", "templateId")
SELECT "id", "emailTemplateId"
FROM "treasury_dunning_rules"
WHERE "emailTemplateId" IS NOT NULL;

-- 3) Remove a FK + coluna antiga
ALTER TABLE "treasury_dunning_rules"
    DROP CONSTRAINT "treasury_dunning_rules_emailTemplateId_fkey";

ALTER TABLE "treasury_dunning_rules"
    DROP COLUMN "emailTemplateId";
