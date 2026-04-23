import { encrypt, decrypt } from '../../../plugins/encrypt.js';
import { httpError } from '../../../lib/errors.js';
export class TreasuryBankAccountsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async resolveFinalBalance(bankAccountId, openingBalance) {
        // Step 1: derive balance from the imported chain (movements with balanceAfter set by bank statement)
        const lastDate = await this.prisma.treasuryBankMovement.findFirst({
            where: { bankAccountId, deletedAt: null, balanceAfter: { not: null } },
            orderBy: { date: 'desc' },
            select: { date: true },
        });
        let chainBalance;
        if (!lastDate) {
            chainBalance = openingBalance;
        }
        else {
            const lastDayMovs = await this.prisma.treasuryBankMovement.findMany({
                where: { bankAccountId, deletedAt: null, date: lastDate.date, balanceAfter: { not: null } },
                select: { amount: true, balanceAfter: true },
            });
            if (lastDayMovs.length === 1) {
                chainBalance = Number(lastDayMovs[0].balanceAfter);
            }
            else {
                const startingBalances = new Set(lastDayMovs.map((m) => Math.round((Number(m.balanceAfter) - Number(m.amount)) * 100)));
                const tail = lastDayMovs.find((m) => !startingBalances.has(Math.round(Number(m.balanceAfter) * 100)));
                chainBalance = tail ? Number(tail.balanceAfter) : Number(lastDayMovs[0].balanceAfter);
            }
        }
        // Step 2: add movements that are not part of the chain (manual entries have balanceAfter = null)
        const manualAgg = await this.prisma.treasuryBankMovement.aggregate({
            where: { bankAccountId, deletedAt: null, balanceAfter: null },
            _sum: { amount: true },
        });
        return chainBalance + Number(manualAgg._sum.amount ?? 0);
    }
    async list(clientId) {
        const accounts = await this.prisma.treasuryBankAccount.findMany({
            where: { clientId, deletedAt: null, isActive: true },
            orderBy: { name: 'asc' },
        });
        const balances = await Promise.all(accounts.map((a) => this.resolveFinalBalance(a.id, Number(a.openingBalance))));
        return accounts.map(({ ibanEnc: _enc, ...acc }, i) => ({
            ...acc,
            currentBalance: balances[i],
        }));
    }
    async getById(clientId, id) {
        const acc = await this.prisma.treasuryBankAccount.findFirst({ where: { id, clientId, deletedAt: null } });
        if (!acc)
            throw httpError(404, 'Bank account not found');
        const { ibanEnc: _enc, ...rest } = acc;
        return rest;
    }
    async create(clientId, data) {
        const { iban, openingBalance = 0, ...rest } = data;
        // Name duplicate check
        const sameName = await this.prisma.treasuryBankAccount.findFirst({
            where: { clientId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' } },
        });
        if (sameName)
            throw httpError(409, `Já existe uma conta com o nome "${data.name}"`);
        // IBAN duplicate check (decrypt existing accounts in memory — clients have few accounts)
        if (iban) {
            const normalizedIban = iban.replace(/\s/g, '').toUpperCase();
            const existing = await this.prisma.treasuryBankAccount.findMany({
                where: { clientId, deletedAt: null, ibanEnc: { not: null } },
                select: { id: true, name: true, ibanEnc: true },
            });
            for (const acc of existing) {
                if (acc.ibanEnc && decrypt(acc.ibanEnc).replace(/\s/g, '').toUpperCase() === normalizedIban) {
                    throw httpError(409, `O IBAN já está associado à conta "${acc.name}"`);
                }
            }
        }
        const ibanEnc = iban ? encrypt(iban) : undefined;
        const ibanLast4 = iban ? iban.replace(/\s/g, '').slice(-4) : undefined;
        const acc = await this.prisma.treasuryBankAccount.create({
            data: {
                clientId,
                ...rest,
                ibanEnc,
                ibanLast4,
                openingBalance,
                currentBalance: openingBalance,
            },
        });
        const { ibanEnc: _enc, ...result } = acc;
        return result;
    }
    async update(clientId, id, data) {
        await this.getById(clientId, id);
        if (data.name) {
            const sameName = await this.prisma.treasuryBankAccount.findFirst({
                where: { clientId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' }, NOT: { id } },
            });
            if (sameName)
                throw httpError(409, `Já existe uma conta com o nome "${data.name}"`);
        }
        const acc = await this.prisma.treasuryBankAccount.update({ where: { id }, data });
        const { ibanEnc: _enc, ...result } = acc;
        return result;
    }
    async delete(clientId, id) {
        await this.getById(clientId, id);
        return this.prisma.treasuryBankAccount.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    }
    async recalcBalance(bankAccountId) {
        const account = await this.prisma.treasuryBankAccount.findUnique({ where: { id: bankAccountId } });
        if (!account)
            return;
        const currentBalance = await this.resolveFinalBalance(bankAccountId, Number(account.openingBalance));
        await this.prisma.treasuryBankAccount.update({ where: { id: bankAccountId }, data: { currentBalance } });
    }
    decryptIban(ibanEnc) {
        return decrypt(ibanEnc);
    }
}
//# sourceMappingURL=bank-accounts.service.js.map