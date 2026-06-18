-- Recorrentes futuras por pagar passam a Programadas (SCHEDULED) e perdem a
-- referência auto-gerada (será definida ao comprometer). Pagas/passadas ficam.
UPDATE "treasury_receivables"
SET "status" = 'SCHEDULED', "reference" = NULL, "updatedAt" = NOW()
WHERE "recurrenceId" IS NOT NULL
  AND "status" = 'OPEN'
  AND "deletedAt" IS NULL
  AND "dueDate" > NOW();

UPDATE "treasury_payables"
SET "status" = 'SCHEDULED', "reference" = NULL, "updatedAt" = NOW()
WHERE "recurrenceId" IS NOT NULL
  AND "status" = 'OPEN'
  AND "deletedAt" IS NULL
  AND "dueDate" > NOW();
