import { httpError } from '../../../lib/errors.js';
export class TreasuryCategoriesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(clientId, type) {
        return this.prisma.treasuryCategory.findMany({
            where: { clientId, deletedAt: null, isArchived: false, ...(type ? { type } : {}) },
            orderBy: { name: 'asc' },
        });
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