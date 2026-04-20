import type { FastifyInstance } from 'fastify'
import { TreasuryCategoriesService } from './categories.service.js'
import type { TreasuryCategoryType } from '@prisma/client'

export async function categoriesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryCategoriesService(fastify.prisma)
  const prefix = '/treasury/:clientId/categories'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { type } = request.query as { type?: TreasuryCategoryType }
    return reply.send(await svc.list(clientId, type))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryCategoriesService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryCategoriesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
