import type { FastifyInstance } from 'fastify'
import { TreasuryBankAccountsService } from './bank-accounts.service.js'

export async function bankAccountsRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBankAccountsService(fastify.prisma)
  const prefix = '/treasury/:clientId/bank-accounts'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.list(clientId))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryBankAccountsService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryBankAccountsService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
