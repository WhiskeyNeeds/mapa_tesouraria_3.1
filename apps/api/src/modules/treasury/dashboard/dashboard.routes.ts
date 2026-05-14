import type { FastifyInstance } from 'fastify'
import { TreasuryDashboardService } from './dashboard.service.js'

export async function dashboardRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryDashboardService(fastify.prisma)
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get('/treasury/:clientId/dashboard/overview', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { days } = request.query as { days?: string }
    return reply.send(await svc.getOverview(clientId, days ? parseInt(days) : 30))
  })

  fastify.get('/treasury/:clientId/dashboard/cash-flow', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { year } = request.query as { year?: string }
    return reply.send(await svc.getCashFlowMonthly(clientId, year ? parseInt(year) : new Date().getFullYear()))
  })

  fastify.get('/treasury/:clientId/dashboard/forecast', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { days } = request.query as { days?: string }
    return reply.send(await svc.getForecast(clientId, days ? parseInt(days) : 90))
  })

  fastify.get('/treasury/:clientId/dashboard/category-breakdown', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { days } = request.query as { days?: string }
    return reply.send(await svc.getCategoryBreakdown(clientId, days ? parseInt(days) : 30))
  })

  fastify.get('/treasury/:clientId/dashboard/cashflow-statement', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { year } = request.query as { year?: string }
    return reply.send(await svc.getCashflowStatement(clientId, year ? parseInt(year) : new Date().getFullYear()))
  })

  fastify.get('/treasury/:clientId/dashboard/cash-positioning', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { count, startDate } = request.query as { count?: string; startDate?: string }
    return reply.send(await svc.getCashPositioning(clientId, count ? parseInt(count) : 12, startDate))
  })
}
