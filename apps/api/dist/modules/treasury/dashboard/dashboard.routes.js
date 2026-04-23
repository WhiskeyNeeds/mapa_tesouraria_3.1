import { TreasuryDashboardService } from './dashboard.service.js';
export async function dashboardRoutes(fastify) {
    const svc = new TreasuryDashboardService(fastify.prisma);
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get('/treasury/:clientId/dashboard/overview', { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const { days } = request.query;
        return reply.send(await svc.getOverview(clientId, days ? parseInt(days) : 30));
    });
    fastify.get('/treasury/:clientId/dashboard/cash-flow', { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const { year } = request.query;
        return reply.send(await svc.getCashFlowMonthly(clientId, year ? parseInt(year) : new Date().getFullYear()));
    });
    fastify.get('/treasury/:clientId/dashboard/forecast', { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const { days } = request.query;
        return reply.send(await svc.getForecast(clientId, days ? parseInt(days) : 90));
    });
}
//# sourceMappingURL=dashboard.routes.js.map