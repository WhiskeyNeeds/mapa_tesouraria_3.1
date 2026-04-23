import { ClientsService } from './clients.service.js';
export async function clientsRoutes(fastify) {
    const svc = new ClientsService(fastify.prisma);
    fastify.get('/clients', { onRequest: [fastify.authenticate] }, async (request, reply) => {
        return reply.send(await svc.getAll(request.user));
    });
    fastify.get('/clients/:clientId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getById(clientId, request.user));
    });
    fastify.post('/clients', { onRequest: [fastify.authenticate] }, async (request, reply) => {
        const body = request.body;
        return reply.status(201).send(await svc.create(body, request.user));
    });
    fastify.patch('/clients/:clientId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.send(await svc.update(clientId, body));
    });
    fastify.delete('/clients/:clientId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId } = request.params;
        await svc.delete(clientId);
        return reply.status(204).send();
    });
    fastify.get('/clients/:clientId/users', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getUsers(clientId));
    });
    fastify.post('/clients/:clientId/users/:userId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId, userId } = request.params;
        return reply.status(201).send(await svc.assignUser(clientId, userId));
    });
    fastify.delete('/clients/:clientId/users/:userId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId, userId } = request.params;
        await svc.removeUser(clientId, userId);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=clients.routes.js.map