import type { FastifyInstance } from 'fastify'
import { ToconlineService } from './toconline.service.js'

export async function toconlineRoutes(fastify: FastifyInstance) {
  const svc = new ToconlineService(fastify.prisma)

  fastify.get('/toconline/config/:clientId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getPublicConfig(clientId))
  })

  // Admin-only: returns decrypted credentials for manual API testing
  fastify.get('/toconline/config/:clientId/credentials', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCredentialsForTesting(clientId))
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

  // Legacy backend callback (kept for backwards compat)
  fastify.get('/toconline/callback', async (request, reply) => {
    const { code, state } = request.query as { code: string; state: string }
    await svc.handleCallback(code, state, fastify.redis)
    return reply.redirect(`${process.env.FRONTEND_URL}/definicoes?toconline=success`)
  })

  // Frontend-initiated callback: frontend sends code+state after the redirect
  fastify.post('/toconline/callback', async (request, reply) => {
    const { code, state } = request.body as { code: string; state: string }
    await svc.handleCallback(code, state, fastify.redis)
    return reply.status(204).send()
  })

  fastify.get('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    return reply.send(await svc.getPurchaseDocuments(clientId, filters))
  })

  fastify.post('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createPurchaseDocument(clientId, request.body))
  })

  fastify.get('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    return reply.send(await svc.getSalesDocuments(clientId, filters))
  })

  fastify.post('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createSalesDocument(clientId, request.body))
  })

  fastify.get('/toconline/:clientId/countries', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCountries(clientId))
  })

  fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCustomers(clientId))
  })

  fastify.get('/toconline/:clientId/customers/:customerId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, customerId } = request.params as { clientId: string; customerId: string }
    return reply.send(await svc.getCustomerWithAddress(clientId, customerId))
  })

  fastify.post('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createCustomer(clientId, request.body as Record<string, unknown>))
  })

  fastify.post('/toconline/:clientId/addresses', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createAddress(clientId, request.body as Record<string, unknown>))
  })

  fastify.patch('/toconline/:clientId/addresses/:addressId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, addressId } = request.params as { clientId: string; addressId: string }
    return reply.send(await svc.patchAddress(clientId, addressId, request.body as Record<string, unknown>))
  })

  fastify.get('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getSuppliers(clientId))
  })

  fastify.post('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createSupplier(clientId, request.body as Record<string, unknown>))
  })

  fastify.get('/toconline/:clientId/expense-categories', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getExpenseCategories(clientId))
  })

  fastify.get('/toconline/:clientId/items', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getItems(clientId))
  })

  fastify.post('/toconline/:clientId/items', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createItem(clientId, request.body as Record<string, unknown>))
  })

  fastify.get('/toconline/:clientId/services', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getServices(clientId))
  })

  fastify.post('/toconline/:clientId/services', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createService(clientId, request.body as Record<string, unknown>))
  })

  // ── Analítica (product cost-center distribution, stored locally) ──────────

  fastify.get('/toconline/:clientId/analytics', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { itemType } = request.query as { itemType?: string }
    return reply.send(await svc.getAnalytics(clientId, itemType))
  })

  fastify.get('/toconline/:clientId/analytics/:itemId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, itemId } = request.params as { clientId: string; itemId: string }
    const { itemType } = request.query as { itemType?: string }
    return reply.send(await svc.getItemAnalytic(clientId, itemId, itemType ?? 'product'))
  })

  fastify.put('/toconline/:clientId/analytics/:itemId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, itemId } = request.params as { clientId: string; itemId: string }
    const body = request.body as { itemType: string; entries: unknown[] }
    return reply.send(await svc.saveItemAnalytic(clientId, itemId, body.itemType, body.entries))
  })

  fastify.delete('/toconline/:clientId/analytics/:itemId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, itemId } = request.params as { clientId: string; itemId: string }
    const { itemType } = request.query as { itemType?: string }
    await svc.deleteItemAnalytic(clientId, itemId, itemType ?? 'product')
    return reply.status(204).send()
  })
}
