import { TreasuryCategoriesService } from './categories.service.js';
export async function categoriesRoutes(fastify) {
    const svc = new TreasuryCategoriesService(fastify.prisma);
    const prefix = '/treasury/:clientId/categories';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const { type } = request.query;
        return reply.send(await svc.list(clientId, type));
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
//# sourceMappingURL=categories.routes.js.map