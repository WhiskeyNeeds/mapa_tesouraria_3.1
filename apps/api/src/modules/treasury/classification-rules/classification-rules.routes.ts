import type { FastifyInstance } from 'fastify'
import { TreasuryClassificationRulesService } from './classification-rules.service.js'

export async function classificationRulesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryClassificationRulesService(fastify.prisma)
  const prefix = '/treasury/:clientId/classification-rules'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.list(clientId))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryClassificationRulesService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryClassificationRulesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
