import { TreasuryPayablesService } from './payables.service.js';
export async function payablesRoutes(fastify) {
    const svc = new TreasuryPayablesService(fastify.prisma);
    const prefix = '/treasury/:clientId/payables';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const q = request.query;
        return reply.send(await svc.list(clientId, {
            ...q,
            isRecurrent: q.isRecurrent !== undefined ? q.isRecurrent === 'true' : undefined,
            page: q.page ? parseInt(q.page) : undefined,
            limit: q.limit ? parseInt(q.limit) : undefined,
        }));
    });
    fastify.get(`${prefix}/kpis`, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getKpis(clientId));
    });
    fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.getById(clientId, id));
    });
    fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.status(201).send(await svc.create(clientId, request.user.sub, body));
    });
    fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        const body = request.body;
        return reply.send(await svc.update(clientId, id, body));
    });
    fastify.post(`${prefix}/:id/void`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.void(clientId, id));
    });
    fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        await svc.delete(clientId, id);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=payables.routes.js.map