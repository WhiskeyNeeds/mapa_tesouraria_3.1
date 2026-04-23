import type { FastifyInstance } from 'fastify'
import { ToconlineService } from './toconline.service.js'

export async function toconlineRoutes(fastify: FastifyInstance) {
  const svc = new ToconlineService(fastify.prisma)

  fastify.get('/toconline/config/:clientId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getPublicConfig(clientId))
  })

  fastify.put('/toconline/config/:clientId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<ToconlineService['saveCredentials']>[1]
    return reply.send(await svc.saveCredentials(clientId, body))
  })

  fastify.delete('/toconline/config/:clientId', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    await svc.revokeConfig(clientId)
    return reply.status(204).send()
  })

  fastify.put('/toconline/config/:clientId/tokens', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as { accessToken: string; refreshToken?: string; expiresIn?: number }
    await svc.setTokensManually(clientId, body)
    return reply.status(204).send()
  })

  fastify.post('/toconline/config/:clientId/auth', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const url = await svc.getAuthUrl(clientId, fastify.redis)
    return reply.send({ url })
  })

  fastify.get('/toconline/callback', async (request, reply) => {
    const { code, state } = request.query as { code: string; state: string }
    await svc.handleCallback(code, state, fastify.redis)
    return reply.redirect(`${process.env.FRONTEND_URL}/definicoes?toconline=success`)
  })

  fastify.get('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    return reply.send(await svc.getPurchaseDocuments(clientId, filters))
  })

  fastify.get('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    return reply.send(await svc.getSalesDocuments(clientId, filters))
  })

  fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCustomers(clientId))
  })

  fastify.get('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getSuppliers(clientId))
  })

  fastify.get('/toconline/:clientId/expense-categories', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getExpenseCategories(clientId))
  })
}
