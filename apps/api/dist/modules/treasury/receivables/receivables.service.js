import { httpError } from '../../../lib/errors.js';
export class TreasuryReceivablesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(clientId, filters) {
        const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, isRecurrent } = filters;
        const where = {
            clientId,
            deletedAt: null,
            ...(status ? { status } : {}),
            ...(origin ? { origin } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(entityName ? { entityName: { contains: entityName, mode: 'insensitive' } } : {}),
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
                orderBy: { dueDate: 'asc' },
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
                recurrenceId: data.recurrenceId,
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