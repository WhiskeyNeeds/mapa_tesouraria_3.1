import { httpError } from '../../lib/errors.js';
export class ClientsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getAll(caller) {
        const isAdmin = caller.roles.some((r) => r.level === 0);
        const where = isAdmin
            ? { deletedAt: null }
            : { deletedAt: null, userClients: { some: { userId: caller.sub } } };
        return this.prisma.client.findMany({
            where,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, nif: true, isActive: true, countryCode: true, createdAt: true },
        });
    }
    async getById(clientId, caller) {
        await this.assertClientAccess(caller, clientId);
        const client = await this.prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
        if (!client)
            throw httpError(404, 'Company not found');
        return client;
    }
    async create(data, caller) {
        const existing = await this.prisma.client.findFirst({ where: { nif: data.nif } });
        if (existing && !existing.deletedAt)
            throw httpError(409, 'NIF already exists');
        const client = await this.prisma.client.create({ data });
        const isAdmin = caller.roles.some((r) => r.level === 0);
        if (!isAdmin) {
            await this.prisma.userClient.create({ data: { userId: caller.sub, clientId: client.id } });
        }
        await this.prisma.treasurySettings.create({ data: { clientId: client.id, lowBalanceChannels: ['inapp'] } });
        return client;
    }
    async update(clientId, data) {
        return this.prisma.client.update({ where: { id: clientId }, data });
    }
    async delete(clientId) {
        return this.prisma.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
    }
    async getUsers(clientId) {
        return this.prisma.userClient.findMany({
            where: { clientId },
            include: {
                user: {
                    select: { id: true, name: true, email: true, isActive: true, userRoles: { include: { role: true } } },
                },
            },
        });
    }
    async assignUser(clientId, userId) {
        const existing = await this.prisma.userClient.findUnique({
            where: { userId_clientId: { userId, clientId } },
        });
        if (existing)
            throw httpError(409, 'User already has access');
        return this.prisma.userClient.create({ data: { userId, clientId } });
    }
    async removeUser(clientId, userId) {
        return this.prisma.userClient.delete({ where: { userId_clientId: { userId, clientId } } });
    }
    async assertClientAccess(caller, clientId) {
        const isAdmin = caller.roles.some((r) => r.level === 0);
        if (isAdmin)
            return;
        const link = await this.prisma.userClient.findUnique({
            where: { userId_clientId: { userId: caller.sub, clientId } },
        });
        if (!link)
            throw httpError(403, 'Access denied to this company');
    }
}
//# sourceMappingURL=clients.service.js.map