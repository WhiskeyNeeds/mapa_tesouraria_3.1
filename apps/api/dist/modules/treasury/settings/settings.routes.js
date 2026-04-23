import { TreasurySettingsService } from './settings.service.js';
export async function settingsRoutes(fastify) {
    const svc = new TreasurySettingsService(fastify.prisma);
    const prefix = '/treasury/:clientId/settings';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.get(clientId));
    });
    fastify.patch(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.send(await svc.update(clientId, body));
    });
}
//# sourceMappingURL=settings.routes.js.map