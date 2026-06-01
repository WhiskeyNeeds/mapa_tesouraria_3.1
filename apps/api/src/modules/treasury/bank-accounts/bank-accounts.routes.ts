import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
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
    const acc = await svc.create(clientId, body)
    await fastify.prisma.treasuryAuditLog.create({
      data: {
        clientId, userId: request.user.sub, action: 'account.create', entityType: 'BankAccount', entityId: acc.id,
        payload: { name: acc.name, bankName: acc.bankName, openingBalance: Number(acc.openingBalance) },
      },
    })
    return reply.status(201).send(acc)
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryBankAccountsService['update']>[2]
    const acc = await svc.update(clientId, id, body)
    await fastify.prisma.treasuryAuditLog.create({
      data: {
        clientId, userId: request.user.sub, action: 'account.update', entityType: 'BankAccount', entityId: id,
        payload: body as unknown as Prisma.InputJsonValue,
      },
    })
    return reply.send(acc)
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
