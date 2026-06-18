-- Novo estado: faturas programadas (recorrências futuras estimadas, ainda não comprometidas).
-- ADD VALUE não pode coexistir com o seu uso na mesma transação — fica sozinho neste ficheiro.
ALTER TYPE "TreasuryDocStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
