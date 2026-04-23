import { TreasuryClassificationRulesService } from './classification-rules.service.js';
export async function classificationRulesRoutes(fastify) {
    const svc = new TreasuryClassificationRulesService(fastify.prisma);
    const prefix = '/treasury/:clientId/classification-rules';
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
//# sourceMappingURL=classification-rules.routes.js.map