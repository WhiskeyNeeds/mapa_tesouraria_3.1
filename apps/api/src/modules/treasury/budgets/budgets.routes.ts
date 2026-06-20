import type { FastifyInstance } from 'fastify'
import { TreasuryBudgetsService } from './budgets.service.js'
import type { TreasuryBudgetStatus, TreasuryCategoryType } from '@prisma/client'

export async function budgetsRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBudgetsService(fastify.prisma)
  const prefix = '/treasury/:clientId/budgets'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { status?: TreasuryBudgetStatus; type?: TreasuryCategoryType }
    return reply.send(await svc.list(clientId, { status: q.status, type: q.type }))
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryBudgetsService['create']>[2]
    return reply.status(201).send(await svc.create(clientId, request.user.sub, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryBudgetsService['update']>[3]
    return reply.send(await svc.update(clientId, request.user.sub, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, request.user.sub, id)
    return reply.status(204).send()
  })

  fastify.get(`${prefix}/:id/events`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const q = request.query as { limit?: string; before?: string }
    return reply.send(await svc.listEvents(clientId, id, {
      limit: q.limit ? Number(q.limit) : undefined,
      before: q.before,
    }))
  })
}
