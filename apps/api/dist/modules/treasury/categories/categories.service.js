import { httpError } from '../../../lib/errors.js';
export class TreasuryCategoriesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(clientId, type, includeArchived = false) {
        const [categories, movementCounts] = await Promise.all([
            this.prisma.treasuryCategory.findMany({
                where: { clientId, deletedAt: null, ...(includeArchived ? {} : { isArchived: false }), ...(type ? { type } : {}) },
                orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
            }),
            this.prisma.treasuryBankMovement.groupBy({
                by: ['categoryId'],
                where: { clientId, deletedAt: null, categoryId: { not: null } },
                _count: { id: true },
            }),
        ]);
        const countMap = new Map(movementCounts.map((c) => [c.categoryId, c._count.id]));
        return categories.map((cat) => ({ ...cat, usageCount: countMap.get(cat.id) ?? 0 }));
    }
    async getById(clientId, id) {
        const cat = await this.prisma.treasuryCategory.findFirst({ where: { id, clientId, deletedAt: null } });
        if (!cat)
            throw httpError(404, 'Category not found');
        return cat;
    }
    async create(clientId, data) {
        return this.prisma.treasuryCategory.create({ data: { clientId, ...data } });
    }
    async update(clientId, id, data) {
        await this.getById(clientId, id);
        return this.prisma.treasuryCategory.update({ where: { id }, data });
    }
    async delete(clientId, id) {
        await this.getById(clientId, id);
        return this.prisma.treasuryCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    }
}
//# sourceMappingURL=categories.service.js.map