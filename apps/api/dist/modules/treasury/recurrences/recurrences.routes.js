import { TreasuryRecurrencesService } from './recurrences.service.js';
export async function recurrencesRoutes(fastify) {
    const svc = new TreasuryRecurrencesService(fastify.prisma);
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get('/treasury/:clientId/recurrences', { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.list(clientId));
    });
    fastify.get('/treasury/:clientId/recurrences/:id', { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.getById(clientId, id));
    });
    fastify.patch('/treasury/:clientId/recurrences/:id/deactivate', { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.deactivate(clientId, id));
    });
    fastify.post('/treasury/:clientId/recurrences/process', { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const { horizonDays } = request.query;
        return reply.send(await svc.processForClient(clientId, horizonDays ? parseInt(horizonDays) : 180));
    });
}
//# sourceMappingURL=recurrences.routes.js.map