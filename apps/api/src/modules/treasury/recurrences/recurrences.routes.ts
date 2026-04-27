import type { FastifyInstance } from 'fastify'
import { TreasuryRecurrencesService } from './recurrences.service.js'

export async function recurrencesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryRecurrencesService(fastify.prisma)
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get('/treasury/:clientId/recurrences', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.list(clientId))
  })

  fastify.get('/treasury/:clientId/recurrences/:id', { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.patch('/treasury/:clientId/recurrences/:id/deactivate', { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.deactivate(clientId, id))
  })

  fastify.post('/treasury/:clientId/recurrences/process', { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { horizonDays } = request.query as { horizonDays?: string }
    return reply.send(await svc.processForClient(clientId, horizonDays ? parseInt(horizonDays) : 180))
  })
}
