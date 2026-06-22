import type { FastifyInstance } from 'fastify'
import { TreasuryBudgetRulesService } from './budget-rules.service.js'

export async function budgetRulesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBudgetRulesService(fastify.prisma)
  const prefix = '/treasury/:clientId/budget-rules'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  // GET /treasury/:clientId/budget-rules?budgetId=xxx  (opcional — filtra por budget)
  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { budgetId } = request.query as { budgetId?: string }
    return reply.send(await svc.list(clientId, budgetId))
  })

  // GET /treasury/:clientId/budget-rules/suggest?categoryId=xxx&text=yyy
  // Nota: rota estática "suggest" ANTES da rota dinâmica "/:id" — Fastify resolve estáticas primeiro.
  fastify.get(`${prefix}/suggest`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { categoryId, text } = request.query as { categoryId?: string; text?: string }
    return reply.send(await svc.suggest(clientId, categoryId, text))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as { budgetId: string; categoryId: string; textPattern?: string }
    return reply.status(201).send(await svc.create(clientId, request.user.sub, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as { textPattern?: string | null }
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, request.user.sub, id)
    return reply.status(204).send()
  })
}
