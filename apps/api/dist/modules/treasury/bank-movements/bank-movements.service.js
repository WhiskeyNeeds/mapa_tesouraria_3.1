import { createHash, randomUUID } from 'crypto';
import { Prisma as PrismaRuntime } from '@prisma/client';
import { httpError } from '../../../lib/errors.js';
import { TreasuryBankAccountsService } from '../bank-accounts/bank-accounts.service.js';
export class TreasuryBankMovementsService {
    prisma;
    bankSvc;
    constructor(prisma) {
        this.prisma = prisma;
        this.bankSvc = new TreasuryBankAccountsService(prisma);
    }
    async recalcManualBalances(bankAccountId) {
        const account = await this.prisma.treasuryBankAccount.findUnique({
            where: { id: bankAccountId },
            select: { openingBalance: true },
        });
        const movs = await this.prisma.treasuryBankMovement.findMany({
            where: { bankAccountId, deletedAt: null },
            select: { id: true, amount: true, balanceAfter: true },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        });
        let running = Number(account?.openingBalance ?? 0);
        const updates = [];
        for (const mov of movs) {
            if (mov.balanceAfter !== null) {
                running = Number(mov.balanceAfter);
            }
            else {
                running = running + Number(mov.amount);
                updates.push({ id: mov.id, balanceAfter: running });
            }
        }
        if (updates.length > 0) {
            await Promise.all(updates.map(({ id, balanceAfter }) => this.prisma.treasuryBankMovement.update({ where: { id }, data: { balanceAfter } })));
        }
    }
    buildDedupeHash(clientId, bankAccountId, date, amount, desc, balanceAfter) {
        const balance = balanceAfter != null ? String(balanceAfter) : '';
        return createHash('sha256').update(`${clientId}|${bankAccountId}|${date}|${amount}|${desc}|${balance}`).digest('hex');
    }
    normalize(text) {
        return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }
    toDateKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.toISOString().substring(0, 10);
    }
    toAmountKey(amount) {
        return Number(amount).toFixed(2);
    }
    toBalanceKey(balanceAfter) {
        return balanceAfter == null ? '' : Number(balanceAfter).toFixed(2);
    }
    buildLogicalKey(bankAccountId, date, amount, normalizedDesc, balanceAfter) {
        return `${bankAccountId}|${this.toDateKey(date)}|${this.toAmountKey(amount)}|${normalizedDesc}|${this.toBalanceKey(balanceAfter)}`;
    }
    async list(clientId, filters) {
        const { page = 1, limit = 50, bankAccountId, status, dateFrom, dateTo, search, direction, sortBy = 'date', sortDir = 'desc' } = filters;
        const where = {
            clientId,
            deletedAt: null,
            bankAccount: { deletedAt: null, isActive: true },
            ...(bankAccountId ? { bankAccountId } : {}),
            ...(status ? { status } : {}),
            ...(direction === 'income' ? { amount: { gt: 0 } } : direction === 'expense' ? { amount: { lt: 0 } } : {}),
            ...(search ? { normalizedDesc: { contains: this.normalize(search) } } : {}),
            ...(dateFrom || dateTo ? {
                date: {
                    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                    ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
                },
            } : {}),
        };
        const dir = sortDir;
        const orderBy = (sortBy === 'amount' ? [{ amount: dir }, { date: 'desc' }] :
            sortBy === 'description' ? [{ description: dir }, { date: 'desc' }] :
                sortBy === 'balanceAfter' ? [{ balanceAfter: dir }, { date: 'desc' }] :
                    [{ date: dir }, { source: 'asc' }, { createdAt: 'asc' }]);
        const [total, items] = await Promise.all([
            this.prisma.treasuryBankMovement.count({ where }),
            this.prisma.treasuryBankMovement.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, color: true, type: true } },
                    bankAccount: { select: { id: true, name: true, bankName: true } },
                },
                orderBy,
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        return { total, page, limit, items };
    }
    async importMovements(clientId, bankAccountId, movements, source, userId, importId) {
        let imported = 0;
        let duplicated = 0;
        const failed = [];
        // Pre-compute hashes for all incoming movements
        const incomingWithHash = movements.map((mov) => ({
            mov,
            dedupeHash: this.buildDedupeHash(clientId, bankAccountId, mov.date, mov.amount, mov.description, mov.balanceAfter),
            normalizedDesc: this.normalize(mov.description),
        }));
        // Bulk pre-check: fetch all existing hashes in one query
        const allHashes = incomingWithHash.map((m) => m.dedupeHash);
        const existing = await this.prisma.treasuryBankMovement.findMany({
            where: { clientId, bankAccountId, dedupeHash: { in: allHashes } },
            select: { dedupeHash: true },
        });
        const existingHashes = new Set(existing.map((e) => e.dedupeHash));
        // Separate new from duplicate movements upfront
        const hashFiltered = incomingWithHash.filter(({ dedupeHash }) => !existingHashes.has(dedupeHash));
        duplicated = incomingWithHash.length - hashFiltered.length;
        // Second layer: logical duplicate detection (same day/value/normalized description/balance)
        const candidateDates = [...new Set(hashFiltered.map(({ mov }) => this.toDateKey(mov.date)))];
        const candidateAmounts = [...new Set(hashFiltered.map(({ mov }) => Number(mov.amount)))];
        const existingLogicalCandidates = (candidateDates.length && candidateAmounts.length)
            ? await this.prisma.treasuryBankMovement.findMany({
                where: {
                    clientId,
                    bankAccountId,
                    deletedAt: null,
                    date: { in: candidateDates.map((d) => new Date(d)) },
                    amount: { in: candidateAmounts },
                },
                select: { date: true, amount: true, normalizedDesc: true, balanceAfter: true },
            })
            : [];
        const existingLogicalKeys = new Set(existingLogicalCandidates.map((m) => this.buildLogicalKey(bankAccountId, m.date, Number(m.amount), m.normalizedDesc ?? '', m.balanceAfter == null ? null : Number(m.balanceAfter))));
        const seenIncomingLogical = new Set();
        const toInsert = hashFiltered.filter(({ mov, normalizedDesc }) => {
            const logicalKey = this.buildLogicalKey(bankAccountId, mov.date, mov.amount, normalizedDesc, mov.balanceAfter);
            if (existingLogicalKeys.has(logicalKey) || seenIncomingLogical.has(logicalKey)) {
                duplicated++;
                return false;
            }
            seenIncomingLogical.add(logicalKey);
            return true;
        });
        // Load classification rules once
        const rules = await this.prisma.treasuryClassificationRule.findMany({
            where: { clientId, isActive: true },
            orderBy: { priority: 'asc' },
        });
        for (const { mov, dedupeHash, normalizedDesc } of toInsert) {
            // Find matching rule
            let categoryId;
            for (const rule of rules) {
                if (rule.direction && ((rule.direction === 'REVENUE') !== (mov.amount > 0)))
                    continue;
                if (rule.amountMin && Math.abs(mov.amount) < Number(rule.amountMin))
                    continue;
                if (rule.amountMax && Math.abs(mov.amount) > Number(rule.amountMax))
                    continue;
                const field = rule.matchField === 'description' ? normalizedDesc
                    : rule.matchField === 'counterpart' ? (mov.counterpartName ?? '')
                        : (mov.counterpartIban ?? '');
                let matches = false;
                if (rule.matchOp === 'contains')
                    matches = field.includes(this.normalize(rule.matchValue));
                else if (rule.matchOp === 'equals')
                    matches = field === this.normalize(rule.matchValue);
                else if (rule.matchOp === 'startsWith')
                    matches = field.startsWith(this.normalize(rule.matchValue));
                else if (rule.matchOp === 'regex')
                    matches = new RegExp(rule.matchValue, 'i').test(field);
                if (matches) {
                    categoryId = rule.categoryId;
                    await this.prisma.treasuryClassificationRule.update({
                        where: { id: rule.id },
                        data: { hits: { increment: 1 }, lastHitAt: new Date() },
                    });
                    break;
                }
            }
            try {
                await this.prisma.treasuryBankMovement.create({
                    data: {
                        clientId,
                        bankAccountId,
                        date: new Date(mov.date),
                        bookingDate: mov.bookingDate ? new Date(mov.bookingDate) : undefined,
                        amount: mov.amount,
                        balanceAfter: mov.balanceAfter,
                        description: mov.description,
                        normalizedDesc,
                        counterpartName: mov.counterpartName,
                        counterpartIban: mov.counterpartIban,
                        externalRef: mov.externalRef,
                        source,
                        importId: importId ?? null,
                        dedupeHash,
                        status: categoryId ? 'CLASSIFIED' : 'UNCLASSIFIED',
                        categoryId: categoryId ?? null,
                    },
                });
                imported++;
            }
            catch (err) {
                // Safety net for race conditions: another import inserted same hash concurrently
                if (err instanceof PrismaRuntime.PrismaClientKnownRequestError && err.code === 'P2002') {
                    duplicated++;
                }
                else {
                    failed.push(mov.description);
                }
            }
        }
        await this.bankSvc.recalcBalance(bankAccountId);
        return { imported, duplicated, failed: failed.length };
    }
    async createManual(clientId, data) {
        const account = await this.prisma.treasuryBankAccount.findFirst({
            where: { id: data.bankAccountId, clientId, deletedAt: null, isActive: true },
        });
        if (!account)
            throw httpError(404, 'Bank account not found');
        const movement = await this.prisma.treasuryBankMovement.create({
            data: {
                clientId,
                bankAccountId: data.bankAccountId,
                date: new Date(data.date),
                amount: data.amount,
                description: data.description.trim(),
                normalizedDesc: this.normalize(data.description),
                source: 'MANUAL',
                dedupeHash: randomUUID(),
                status: 'UNCLASSIFIED',
            },
        });
        await this.recalcManualBalances(data.bankAccountId);
        await this.bankSvc.recalcBalance(data.bankAccountId);
        return movement;
    }
    async deduplicateMovements(clientId, bankAccountId) {
        const where = { clientId, deletedAt: null, bankAccount: { deletedAt: null, isActive: true }, ...(bankAccountId ? { bankAccountId } : {}) };
        const all = await this.prisma.treasuryBankMovement.findMany({
            where,
            select: { id: true, bankAccountId: true, date: true, amount: true, normalizedDesc: true, balanceAfter: true, createdAt: true, status: true },
            orderBy: { createdAt: 'asc' },
        });
        // Group by (bankAccountId, date, amount, normalizedDesc, balanceAfter) — keep oldest, soft-delete newer duplicates
        const seen = new Map();
        const toRemove = [];
        for (const mov of all) {
            const balance = mov.balanceAfter != null ? String(mov.balanceAfter) : '';
            const key = `${mov.bankAccountId}|${mov.date.toISOString()}|${mov.amount}|${mov.normalizedDesc ?? ''}|${balance}`;
            if (seen.has(key)) {
                if (mov.status !== 'RECONCILED')
                    toRemove.push(mov.id);
            }
            else {
                seen.set(key, true);
            }
        }
        if (toRemove.length > 0) {
            await this.prisma.treasuryBankMovement.updateMany({
                where: { id: { in: toRemove } },
                data: { deletedAt: new Date() },
            });
            // Recalc balance for affected accounts
            const affectedAccounts = [...new Set(all.filter((m) => toRemove.includes(m.id)).map((m) => m.bankAccountId))];
            for (const accId of affectedAccounts) {
                await this.bankSvc.recalcBalance(accId);
            }
        }
        return { removed: toRemove.length };
    }
    async classify(clientId, id, categoryId) {
        const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId, deletedAt: null } });
        if (!mov)
            throw httpError(404, 'Movement not found');
        const newStatus = mov.status === 'UNCLASSIFIED' ? 'CLASSIFIED' : mov.status;
        return this.prisma.treasuryBankMovement.update({ where: { id }, data: { categoryId, status: newStatus } });
    }
    async delete(clientId, id) {
        const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId } });
        if (!mov)
            throw httpError(404, 'Movement not found');
        if (mov.status === 'RECONCILED')
            throw httpError(409, 'Cannot delete a reconciled movement');
        await this.prisma.treasuryBankMovement.update({ where: { id }, data: { deletedAt: new Date() } });
        await this.recalcManualBalances(mov.bankAccountId);
        await this.bankSvc.recalcBalance(mov.bankAccountId);
    }
    async getSummary(clientId, bankAccountId) {
        const where = { clientId, deletedAt: null, bankAccount: { deletedAt: null, isActive: true }, ...(bankAccountId ? { bankAccountId } : {}) };
        const [incomeAgg, expenseAgg, byStatus] = await Promise.all([
            this.prisma.treasuryBankMovement.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
            this.prisma.treasuryBankMovement.aggregate({ where: { ...where, amount: { lt: 0 } }, _sum: { amount: true }, _count: true }),
            this.prisma.treasuryBankMovement.groupBy({ by: ['status'], where, _count: true }),
        ]);
        return {
            totalIncome: Number(incomeAgg._sum.amount ?? 0),
            totalExpense: Number(expenseAgg._sum.amount ?? 0),
            countIncome: incomeAgg._count,
            countExpense: expenseAgg._count,
            byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        };
    }
}
//# sourceMappingURL=bank-movements.service.js.map