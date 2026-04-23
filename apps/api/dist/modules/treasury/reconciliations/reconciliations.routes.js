import { TreasuryReconciliationsService } from './reconciliations.service.js';
export async function reconciliationsRoutes(fastify) {
    const svc = new TreasuryReconciliationsService(fastify.prisma);
    const prefix = '/treasury/:clientId/reconciliations';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const q = request.query;
        return reply.send(await svc.list(clientId, {
            status: q.status,
            page: q.page ? parseInt(q.page) : undefined,
            limit: q.limit ? parseInt(q.limit) : undefined,
        }));
    });
    fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.getById(clientId, id));
    });
    fastify.post(`${prefix}/preview`, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.send(await svc.preview(clientId, body));
    });
    fastify.post(`${prefix}/confirm`, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.status(201).send(await svc.confirm(clientId, request.user.sub, body));
    });
    fastify.post(`${prefix}/:id/reverse`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        const { reason } = (request.body ?? {});
        await svc.reverse(clientId, id, request.user.sub, reason);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=reconciliations.routes.js.map