import { httpError } from '../../../lib/errors.js';
export class TreasuryPayablesService {
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
            this.prisma.treasuryPayable.count({ where }),
            this.prisma.treasuryPayable.findMany({
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
        const item = await this.prisma.treasuryPayable.findFirst({
            where: { id, clientId, deletedAt: null },
            include: { category: true, recurrence: true, reconciliationLinks: { include: { reconciliation: true } } },
        });
        if (!item)
            throw httpError(404, 'Payable not found');
        return item;
    }
    async create(clientId, userId, data) {
        const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } });
        if (!category)
            throw httpError(404, 'Category not found');
        // Dedup by TOConline document ID
        if (data.tocPurchasesDocId) {
            const existing = await this.prisma.treasuryPayable.findFirst({
                where: { clientId, tocPurchasesDocId: data.tocPurchasesDocId, deletedAt: null },
            });
            if (existing)
                throw httpError(409, `Documento ${data.reference} já importado`);
        }
        return this.prisma.treasuryPayable.create({
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
                tocSupplierId: data.tocSupplierId,
                tocPurchasesDocId: data.tocPurchasesDocId,
                reference: data.reference,
                description: data.description,
                recurrenceId: data.recurrenceId,
            },
        });
    }
    async update(clientId, id, data) {
        await this.getById(clientId, id);
        return this.prisma.treasuryPayable.update({
            where: { id },
            data: { ...data, ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}) },
        });
    }
    async void(clientId, id) {
        const item = await this.getById(clientId, id);
        if (item.status === 'SETTLED')
            throw httpError(409, 'Cannot void a settled payable');
        return this.prisma.treasuryPayable.update({ where: { id }, data: { status: 'VOID' } });
    }
    async delete(clientId, id) {
        await this.getById(clientId, id);
        return this.prisma.treasuryPayable.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    async getKpis(clientId) {
        const now = new Date();
        const [totalOpen, overdue, paidMonth] = await Promise.all([
            this.prisma.treasuryPayable.aggregate({
                where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
                _sum: { pendingAmount: true },
                _count: true,
            }),
            this.prisma.treasuryPayable.count({
                where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
            }),
            this.prisma.treasuryPayable.aggregate({
                where: { clientId, deletedAt: null, status: 'SETTLED', updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
                _sum: { totalAmount: true },
            }),
        ]);
        return {
            totalPending: Number(totalOpen._sum.pendingAmount ?? 0),
            countOpen: totalOpen._count,
            countOverdue: overdue,
            paidThisMonth: Number(paidMonth._sum.totalAmount ?? 0),
        };
    }
}
//# sourceMappingURL=payables.service.js.map