import type { FastifyInstance } from 'fastify'
import { TreasuryEntityConfigsService } from './entity-configs.service.js'

export async function entityConfigsRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryEntityConfigsService(fastify.prisma)
  const prefix = '/treasury/:clientId/entity-configs/:type/:tocId'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    const config = await svc.get(clientId, type, tocId)
    return reply.send(config ?? null)
  })

  fastify.put(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    const body = request.body as { defaultCategoryId: string | null }
    return reply.send(await svc.upsert(clientId, type, tocId, body))
  })

  fastify.delete(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    await svc.delete(clientId, type, tocId)
    return reply.status(204).send()
  })
}
