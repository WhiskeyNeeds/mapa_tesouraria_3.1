import type { FastifyInstance } from 'fastify'
import { LocalContactsService } from './local-contacts.service.js'
import type { LocalContactType } from '@prisma/client'

export async function localContactsRoutes(fastify: FastifyInstance) {
  const svc = new LocalContactsService(fastify.prisma)
  const prefix = '/treasury/:clientId/local-contacts'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { type, search } = request.query as { type?: string; search?: string }
    if (!type || !['CUSTOMER', 'SUPPLIER'].includes(type)) {
      return reply.status(400).send({ message: 'type must be CUSTOMER or SUPPLIER' })
    }
    return reply.send(await svc.list(clientId, type as LocalContactType, search))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<LocalContactsService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.get(`${prefix}/:id/doc-count`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getDocCount(clientId, id))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<LocalContactsService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
