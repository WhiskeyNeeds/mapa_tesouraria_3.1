import { ToconlineService } from './toconline.service.js';
export async function toconlineRoutes(fastify) {
    const svc = new ToconlineService(fastify.prisma);
    fastify.get('/toconline/config/:clientId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getPublicConfig(clientId));
    });
    fastify.put('/toconline/config/:clientId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.send(await svc.saveCredentials(clientId, body));
    });
    fastify.delete('/toconline/config/:clientId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId } = request.params;
        await svc.revokeConfig(clientId);
        return reply.status(204).send();
    });
    fastify.put('/toconline/config/:clientId/tokens', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        await svc.setTokensManually(clientId, body);
        return reply.status(204).send();
    });
    fastify.post('/toconline/config/:clientId/auth', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
        const { clientId } = request.params;
        const url = await svc.getAuthUrl(clientId, fastify.redis);
        return reply.send({ url });
    });
    // Legacy backend callback (kept for backwards compat)
    fastify.get('/toconline/callback', async (request, reply) => {
        const { code, state } = request.query;
        await svc.handleCallback(code, state, fastify.redis);
        return reply.redirect(`${process.env.FRONTEND_URL}/definicoes?toconline=success`);
    });
    // Frontend-initiated callback: frontend sends code+state after the redirect
    fastify.post('/toconline/callback', async (request, reply) => {
        const { code, state } = request.body;
        await svc.handleCallback(code, state, fastify.redis);
        return reply.status(204).send();
    });
    fastify.get('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        const filters = request.query;
        return reply.send(await svc.getPurchaseDocuments(clientId, filters));
    });
    fastify.get('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        const filters = request.query;
        return reply.send(await svc.getSalesDocuments(clientId, filters));
    });
    fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getCustomers(clientId));
    });
    fastify.get('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getSuppliers(clientId));
    });
    fastify.get('/toconline/:clientId/expense-categories', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getExpenseCategories(clientId));
    });
}
//# sourceMappingURL=toconline.routes.js.map