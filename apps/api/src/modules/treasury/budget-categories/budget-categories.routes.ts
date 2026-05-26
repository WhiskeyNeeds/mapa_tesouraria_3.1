import type { FastifyInstance } from 'fastify'
import { TreasuryBudgetCategoriesService } from './budget-categories.service.js'
import type { TreasuryCategoryType } from '@prisma/client'

export async function budgetCategoriesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBudgetCategoriesService(fastify.prisma)
  const prefix = '/treasury/:clientId/budget-categories'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { type?: TreasuryCategoryType; includeArchived?: string }
    return reply.send(await svc.list(clientId, {
      type: q.type,
      includeArchived: q.includeArchived === 'true',
    }))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryBudgetCategoriesService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryBudgetCategoriesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
