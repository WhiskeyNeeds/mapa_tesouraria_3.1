-- Reverte para 1 template único por regra. A escolha do tom passa a ser feita
-- na criação da regra (sugerida automaticamente a partir de offsetDays).

-- 1) Recria a coluna emailTemplateId
ALTER TABLE "treasury_dunning_rules"
    ADD COLUMN "emailTemplateId" TEXT;

-- 2) Migra dados: para cada regra com templates associados na join table,
--    escolhe um único templateId (o primeiro determinístico por ordem).
UPDATE "treasury_dunning_rules" r
SET "emailTemplateId" = (
    SELECT t."templateId"
    FROM "treasury_dunning_rule_templates" t
    WHERE t."ruleId" = r."id"
    ORDER BY t."templateId"
    LIMIT 1
);

-- 3) Recria a FK
ALTER TABLE "treasury_dunning_rules"
    ADD CONSTRAINT "treasury_dunning_rules_emailTemplateId_fkey"
    FOREIGN KEY ("emailTemplateId") REFERENCES "treasury_email_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Drop da tabela de junção
DROP TABLE "treasury_dunning_rule_templates";
