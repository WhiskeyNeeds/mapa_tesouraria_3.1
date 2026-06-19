-- Ações planeadas (Tarefa/Chamada) nas réguas de cobrança.
-- actionType default EMAIL garante que todas as regras existentes
-- mantêm exatamente o comportamento atual (não-regressão).

CREATE TYPE "TreasuryDunningActionType" AS ENUM ('EMAIL', 'TASK', 'CALL');

ALTER TABLE "treasury_dunning_rules"
  ADD COLUMN "actionType" "TreasuryDunningActionType" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "taskTitle" VARCHAR(300),
  ADD COLUMN "taskDescription" TEXT,
  ADD COLUMN "taskImportance" "TreasuryFollowupImportance" NOT NULL DEFAULT 'NORMAL';
