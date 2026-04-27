import { httpError } from '../../../lib/errors.js';
export class TreasuryClassificationRulesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(clientId) {
        return this.prisma.treasuryClassificationRule.findMany({
            where: { clientId },
            include: { category: { select: { id: true, name: true, color: true } } },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        });
    }
    async create(clientId, data) {
        return this.prisma.treasuryClassificationRule.create({ data: { clientId, ...data } });
    }
    async update(clientId, id, data) {
        const rule = await this.prisma.treasuryClassificationRule.findFirst({ where: { id, clientId } });
        if (!rule)
            throw httpError(404, 'Rule not found');
        return this.prisma.treasuryClassificationRule.update({ where: { id }, data });
    }
    async delete(clientId, id) {
        const rule = await this.prisma.treasuryClassificationRule.findFirst({ where: { id, clientId } });
        if (!rule)
            throw httpError(404, 'Rule not found');
        return this.prisma.treasuryClassificationRule.delete({ where: { id } });
    }
}
//# sourceMappingURL=classification-rules.service.js.map