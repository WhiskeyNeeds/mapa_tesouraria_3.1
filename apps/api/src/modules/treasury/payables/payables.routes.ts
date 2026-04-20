import type { FastifyInstance } from 'fastify'
import { TreasuryPayablesService } from './payables.service.js'
import type { TreasuryDocStatus, TreasuryDocOrigin } from '@prisma/client'

export async function payablesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryPayablesService(fastify.prisma)
  const prefix = '/treasury/:clientId/payables'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as {
      status?: TreasuryDocStatus; origin?: TreasuryDocOrigin; categoryId?: string
      entityName?: string; dueDateFrom?: string; dueDateTo?: string
      isRecurrent?: string; page?: string; limit?: string
    }
    return reply.send(await svc.list(clientId, {
      ...q,
      isRecurrent: q.isRecurrent !== undefined ? q.isRecurrent === 'true' : undefined,
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    }))
  })

  fastify.get(`${prefix}/kpis`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getKpis(clientId))
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryPayablesService['create']>[2]
    return reply.status(201).send(await svc.create(clientId, request.user.sub, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryPayablesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.post(`${prefix}/:id/void`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.void(clientId, id))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
