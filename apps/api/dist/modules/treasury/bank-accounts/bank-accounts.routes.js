import { TreasuryBankAccountsService } from './bank-accounts.service.js';
export async function bankAccountsRoutes(fastify) {
    const svc = new TreasuryBankAccountsService(fastify.prisma);
    const prefix = '/treasury/:clientId/bank-accounts';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.list(clientId));
    });
    fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.status(201).send(await svc.create(clientId, body));
    });
    fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.getById(clientId, id));
    });
    fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        const body = request.body;
        return reply.send(await svc.update(clientId, id, body));
    });
    fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        await svc.delete(clientId, id);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=bank-accounts.routes.js.map