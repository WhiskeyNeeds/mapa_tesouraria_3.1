import type { FastifyInstance } from 'fastify'
import { TreasurySettingsService } from './settings.service.js'

export async function settingsRoutes(fastify: FastifyInstance) {
  const svc = new TreasurySettingsService(fastify.prisma)
  const prefix = '/treasury/:clientId/settings'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.get(clientId))
  })

  fastify.patch(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasurySettingsService['update']>[1]
    return reply.send(await svc.update(clientId, body))
  })
}
