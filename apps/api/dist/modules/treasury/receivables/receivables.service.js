import { httpError } from '../../../lib/errors.js';
import { computeNextDate } from '../recurrences/utils.js';
export class TreasuryReceivablesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(clientId, filters) {
        const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, isRecurrent, sortBy = 'dueDate', sortDir = 'asc' } = filters;
        const statusFilter = Array.isArray(status)
            ? status.length === 1 ? { status: status[0] } : { status: { in: status } }
            : status ? { status } : {};
        const where = {
            clientId,
            deletedAt: null,
            ...statusFilter,
            ...(origin ? { origin } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(entityName ? { OR: [
                    { entityName: { contains: entityName, mode: 'insensitive' } },
                    { reference: { contains: entityName, mode: 'insensitive' } },
                ] } : {}),
            ...(dueDateFrom || dueDateTo ? {
                dueDate: {
                    ...(dueDateFrom ? { gte: new Date(dueDateFrom) } : {}),
                    ...(dueDateTo ? { lte: new Date(dueDateTo) } : {}),
                },
            } : {}),
            ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
        };
        const [total, items] = await Promise.all([
            this.prisma.treasuryReceivable.count({ where }),
            this.prisma.treasuryReceivable.findMany({
                where,
                include: { category: { select: { id: true, name: true, color: true, launchToc: true } } },
                orderBy: { [sortBy]: sortDir },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        return { total, page, limit, items };
    }
    async getById(clientId, id) {
        const item = await this.prisma.treasuryReceivable.findFirst({
            where: { id, clientId, deletedAt: null },
            include: {
                category: true,
                recurrence: true,
                reconciliationLinks: { include: { reconciliation: true } },
            },
        });
        if (!item)
            throw httpError(404, 'Receivable not found');
        return item;
    }
    async create(clientId, userId, data) {
        const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } });
        if (!category)
            throw httpError(404, 'Category not found');
        if (data.tocSalesDocId) {
            const existing = await this.prisma.treasuryReceivable.findFirst({
                where: { clientId, tocSalesDocId: data.tocSalesDocId, deletedAt: null },
            });
            if (existing)
                throw httpError(409, `Documento ${data.reference} já importado`);
        }
        let recurrenceId = data.recurrenceId;
        if (data.recurrence) {
            const firstDueDate = new Date(data.dueDate);
            const rec = await this.prisma.treasuryRecurrence.create({
                data: {
                    clientId,
                    frequency: data.recurrence.frequency,
                    startDate: firstDueDate,
                    endDate: data.recurrence.endDate ? new Date(data.recurrence.endDate) : null,
                    occurrences: data.recurrence.occurrences ?? null,
                    nextRunAt: computeNextDate(firstDueDate, data.recurrence.frequency),
                },
            });
            recurrenceId = rec.id;
        }
        return this.prisma.treasuryReceivable.create({
            data: {
                clientId,
                createdById: userId,
                origin: category.launchToc ? 'TOCONLINE' : 'LOCAL',
                totalAmount: data.totalAmount,
                pendingAmount: data.totalAmount,
                documentDate: new Date(data.documentDate),
                dueDate: new Date(data.dueDate),
                currency: data.currency ?? 'EUR',
                categoryId: data.categoryId,
                entityName: data.entityName,
                entityNif: data.entityNif,
                tocCustomerId: data.tocCustomerId,
                tocSalesDocId: data.tocSalesDocId,
                reference: data.reference,
                description: data.description,
                recurrenceId,
            },
        });
    }
    async update(clientId, id, data) {
        await this.getById(clientId, id);
        return this.prisma.treasuryReceivable.update({
            where: { id },
            data: { ...data, ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}) },
        });
    }
    async settle(clientId, id) {
        const item = await this.getById(clientId, id);
        if (item.status === 'SETTLED')
            throw httpError(409, 'Already settled');
        if (item.status === 'VOID')
            throw httpError(409, 'Cannot settle a voided receivable');
        return this.prisma.treasuryReceivable.update({
            where: { id },
            data: { status: 'SETTLED', pendingAmount: 0, receivedAmount: item.totalAmount },
        });
    }
    async partialPayment(clientId, id, amount) {
        const item = await this.getById(clientId, id);
        if (item.status === 'SETTLED')
            throw httpError(409, 'Already settled');
        if (item.status === 'VOID')
            throw httpError(409, 'Cannot pay a voided receivable');
        if (amount <= 0)
            throw httpError(400, 'Amount must be positive');
        const newReceived = Number(item.receivedAmount ?? 0) + amount;
        const newPending = Math.max(0, Number(item.totalAmount) - newReceived);
        const newStatus = newPending < 0.005 ? 'SETTLED' : 'PARTIAL';
        return this.prisma.treasuryReceivable.update({
            where: { id },
            data: { receivedAmount: newReceived, pendingAmount: newPending, status: newStatus },
        });
    }
    async void(clientId, id) {
        const item = await this.getById(clientId, id);
        if (item.status === 'SETTLED')
            throw httpError(409, 'Cannot void a settled receivable');
        return this.prisma.treasuryReceivable.update({ where: { id }, data: { status: 'VOID' } });
    }
    async delete(clientId, id) {
        await this.getById(clientId, id);
        return this.prisma.treasuryReceivable.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    async getKpis(clientId) {
        const now = new Date();
        const [totalOpen, overdue, settledMonth] = await Promise.all([
            this.prisma.treasuryReceivable.aggregate({
                where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
                _sum: { pendingAmount: true },
                _count: true,
            }),
            this.prisma.treasuryReceivable.count({
                where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
            }),
            this.prisma.treasuryReceivable.aggregate({
                where: {
                    clientId, deletedAt: null, status: 'SETTLED',
                    updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
                },
                _sum: { totalAmount: true },
            }),
        ]);
        // Aging buckets
        const buckets = await Promise.all([30, 60, 90].map(async (days, i) => {
            const from = i === 0 ? new Date(0) : new Date(Date.now() - days * 86400000);
            const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : (i === 2 ? 61 : 91))) * 86400000);
            return this.prisma.treasuryReceivable.count({
                where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
            });
        }));
        return {
            totalPending: Number(totalOpen._sum.pendingAmount ?? 0),
            countOpen: totalOpen._count,
            countOverdue: overdue,
            settledThisMonth: Number(settledMonth._sum.totalAmount ?? 0),
            aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
        };
    }
}
//# sourceMappingURL=receivables.service.js.map