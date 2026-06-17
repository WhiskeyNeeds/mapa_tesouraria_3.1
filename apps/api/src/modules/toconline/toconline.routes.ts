import type { FastifyInstance } from 'fastify'
import { ToconlineService } from './toconline.service.js'

export async function toconlineRoutes(fastify: FastifyInstance) {
  const svc = new ToconlineService(fastify.prisma)

  // Proxy de lookup de código postal PT (evita CORS no browser)
  fastify.get('/postal/:cp', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { cp } = request.params as { cp: string }
    try {
      // 1. Tentativa exacta (ex: 1000-001)
      const res = await fetch(`https://json.geoapi.pt/cp/${encodeURIComponent(cp)}`)
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>
        if (data.Localidade) return reply.send({ localidade: data.Localidade })
      }

      // 2. Fallback: CP4 (primeiros 4 dígitos) — cobre sufixos inválidos como -000
      const cp4 = cp.split('-')[0]
      if (cp4?.length === 4) {
        const res2 = await fetch(`https://json.geoapi.pt/cp4/${cp4}`)
        if (res2.ok) {
          const list = await res2.json() as Array<Record<string, unknown>>
          const localidade = Array.isArray(list) ? list[0]?.Localidade : null
          if (localidade) return reply.send({ localidade })
        }
      }

      return reply.status(404).send({ localidade: null })
    } catch {
      return reply.status(502).send({ localidade: null })
    }
  })

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
    const clientId = await svc.handleCallback(code, state, fastify.redis)
    void (fastify as any).tocScheduler?.registerClient(clientId)
    return reply.redirect(`${process.env.FRONTEND_URL}/definicoes?toconline=success`)
  })

  // Frontend-initiated callback: frontend sends code+state after the redirect
  fastify.post('/toconline/callback', async (request, reply) => {
    const { code, state } = request.body as { code: string; state: string }
    const clientId = await svc.handleCallback(code, state, fastify.redis)
    void (fastify as any).tocScheduler?.registerClient(clientId)
    return reply.status(204).send()
  })

  fastify.get('/toconline/:clientId/sales/:docId/receipts', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, docId } = request.params as { clientId: string; docId: string }
    const { ids } = request.query as { ids?: string }
    const knownIds = ids ? ids.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0) : undefined
    const [docSync, recSync] = await Promise.all([
      fastify.prisma.tocSyncState.findUnique({ where: { clientId_entityType: { clientId, entityType: 'salesDocuments' } } }),
      fastify.prisma.tocSyncState.findUnique({ where: { clientId_entityType: { clientId, entityType: 'salesReceipts' } } }),
    ])
    if (!docSync?.lastSyncAt || !recSync?.lastSyncAt) {
      return reply.send(await svc.getSalesDocumentReceipts(clientId, docId, knownIds))
    }
    let receiptIds: number[] = knownIds ?? []
    if (receiptIds.length === 0) {
      const doc = await fastify.prisma.tocSalesDocument.findUnique({
        where: { clientId_tocId: { clientId, tocId: Number(docId) } },
        select: { receiptsIds: true },
      })
      receiptIds = doc?.receiptsIds ?? []
    }
    if (receiptIds.length === 0) return reply.send([])
    const rows = await fastify.prisma.tocSalesReceipt.findMany({
      where: { clientId, tocId: { in: receiptIds } },
    })
    // Anexa _received_for_doc = valor que este recibo imputou a esta fatura
    // (linha cuja receivable_id == docId), calculado do raw já guardado.
    const numericDocId = Number(docId)
    return reply.send(rows.map((r) => {
      const raw = r.raw as Record<string, unknown>
      const lines = Array.isArray(raw.lines) ? raw.lines as Array<Record<string, unknown>> : []
      const matchLine = lines.find((l) => Number(l.receivable_id) === numericDocId)
      return { ...raw, _received_for_doc: matchLine ? Number(matchLine.received_value ?? 0) : null }
    }))
  })

  fastify.get('/toconline/:clientId/purchases/:docId/payments', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, docId } = request.params as { clientId: string; docId: string }
    const { ids } = request.query as { ids?: string }
    const knownIds = ids ? ids.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0) : undefined
    const [docSync, paySync] = await Promise.all([
      fastify.prisma.tocSyncState.findUnique({ where: { clientId_entityType: { clientId, entityType: 'purchaseDocuments' } } }),
      fastify.prisma.tocSyncState.findUnique({ where: { clientId_entityType: { clientId, entityType: 'purchasePayments' } } }),
    ])
    if (!docSync?.lastSyncAt || !paySync?.lastSyncAt) {
      return reply.send(await svc.getPurchaseDocumentPayments(clientId, docId, knownIds))
    }
    let paymentIds: number[] = knownIds ?? []
    if (paymentIds.length === 0) {
      const doc = await fastify.prisma.tocPurchaseDocument.findUnique({
        where: { clientId_tocId: { clientId, tocId: Number(docId) } },
        select: { paymentsIds: true },
      })
      paymentIds = doc?.paymentsIds ?? []
    }
    if (paymentIds.length === 0) return reply.send([])
    const rows = await fastify.prisma.tocPurchasePayment.findMany({
      where: { clientId, tocId: { in: paymentIds } },
    })
    // Anexa _paid_for_doc = valor que este pagamento imputou a esta fatura
    // (linha cuja payable_id == docId), calculado do raw já guardado.
    const numericDocId = Number(docId)
    return reply.send(rows.map((r) => {
      const raw = r.raw as Record<string, unknown>
      const lines = Array.isArray(raw.lines) ? raw.lines as Array<Record<string, unknown>> : []
      const matchLine = lines.find((l) => Number(l.payable_id) === numericDocId)
      return { ...raw, _paid_for_doc: matchLine ? Number(matchLine.paid_value ?? matchLine.received_value ?? 0) : null }
    }))
  })

  fastify.get('/toconline/:clientId/sales-receipts/:receiptId/lines', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, receiptId } = request.params as { clientId: string; receiptId: string }
    return reply.send(await svc.getSalesReceiptLines(clientId, receiptId))
  })

  fastify.get('/toconline/:clientId/purchase-payments/:paymentId/lines', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, paymentId } = request.params as { clientId: string; paymentId: string }
    return reply.send(await svc.getPurchasePaymentLines(clientId, paymentId))
  })

  fastify.get('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'purchaseDocuments' } },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send(await svc.getPurchaseDocuments(clientId, filters))
    }
    const supplierIdFilter = filters['filter[supplier_id]']
    const rows = await fastify.prisma.tocPurchaseDocument.findMany({
      where: {
        clientId,
        ...(supplierIdFilter ? { supplierId: Number(supplierIdFilter) } : {}),
      },
      orderBy: { date: 'desc' },
    })
    return reply.send(rows.map((r) => r.raw))
  })

  fastify.post('/toconline/:clientId/purchases', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createPurchaseDocument(clientId, request.body))
  })

  fastify.get('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const filters = request.query as Record<string, string>
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'salesDocuments' } },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send(await svc.getSalesDocuments(clientId, filters))
    }
    const customerIdFilter = filters['filter[customer_id]']
    const rows = await fastify.prisma.tocSalesDocument.findMany({
      where: {
        clientId,
        ...(customerIdFilter ? { customerId: Number(customerIdFilter) } : {}),
      },
      orderBy: { date: 'desc' },
    })
    return reply.send(rows.map((r) => r.raw))
  })

  fastify.post('/toconline/:clientId/sales', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createSalesDocument(clientId, request.body))
  })

  fastify.get('/toconline/:clientId/entity-payment-timing', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { entityType, tocEntityId } = request.query as { entityType?: string; tocEntityId?: string }
    if (!entityType || !tocEntityId) return reply.status(400).send({ error: 'entityType and tocEntityId required' })
    return reply.send(await svc.getEntityPaymentTiming(clientId, entityType as 'customer' | 'supplier', tocEntityId))
  })

  fastify.get('/toconline/:clientId/countries', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCountries(clientId))
  })

  fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'customers' } },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send(await svc.getCustomers(clientId))
    }
    const rows = await fastify.prisma.tocCustomer.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
    })
    return reply.send(rows.map(r => r.raw))
  })

  fastify.patch('/toconline/:clientId/customers/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.updateCustomer(clientId, id, request.body as Record<string, unknown>))
  })

  fastify.delete('/toconline/:clientId/customers/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.deleteCustomer(clientId, id)
    return reply.status(204).send()
  })

  fastify.get('/toconline/:clientId/customers/:customerId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, customerId } = request.params as { clientId: string; customerId: string }
    return reply.send(await svc.getCustomerWithAddress(clientId, customerId))
  })

  fastify.post('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Record<string, unknown>
    const attrs   = ('attrs' in body ? body.attrs   : body) as Record<string, unknown>
    const address = ('attrs' in body ? body.address : undefined) as Record<string, unknown> | undefined
    return reply.status(201).send(await svc.createCustomer(clientId, attrs, address))
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
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'suppliers' } },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send(await svc.getSuppliers(clientId))
    }
    const rows = await fastify.prisma.tocSupplier.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
    })
    return reply.send(rows.map(r => r.raw))
  })

  fastify.patch('/toconline/:clientId/suppliers/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.updateSupplier(clientId, id, request.body as Record<string, unknown>))
  })

  fastify.delete('/toconline/:clientId/suppliers/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.deleteSupplier(clientId, id)
    return reply.status(204).send()
  })

  fastify.get('/toconline/:clientId/suppliers/:supplierId', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, supplierId } = request.params as { clientId: string; supplierId: string }
    return reply.send(await svc.getSupplierWithAddress(clientId, supplierId))
  })

  fastify.post('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Record<string, unknown>
    const attrs   = ('attrs' in body ? body.attrs   : body) as Record<string, unknown>
    const address = ('attrs' in body ? body.address : undefined) as Record<string, unknown> | undefined
    return reply.status(201).send(await svc.createSupplier(clientId, attrs, address))
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

  fastify.patch('/toconline/:clientId/items/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.updateItem(clientId, id, request.body as Record<string, unknown>))
  })

  fastify.delete('/toconline/:clientId/items/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.deleteItem(clientId, id)
    return reply.status(204).send()
  })

  fastify.get('/toconline/:clientId/services', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getServices(clientId))
  })

  fastify.post('/toconline/:clientId/services', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.status(201).send(await svc.createService(clientId, request.body as Record<string, unknown>))
  })

  fastify.patch('/toconline/:clientId/services/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.updateService(clientId, id, request.body as Record<string, unknown>))
  })

  fastify.delete('/toconline/:clientId/services/:id', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.deleteService(clientId, id)
    return reply.status(204).send()
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

  fastify.get('/toconline/:clientId/entity-sub-docs', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { entityType, ids } = request.query as { entityType?: string; ids?: string }
    if (!entityType || !ids) return reply.status(400).send({ error: 'entityType and ids required' })
    const parsedIds = ids.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
    if (parsedIds.length === 0) return reply.send([])

    const syncEntityType = entityType === 'customer' ? 'salesReceipts' : 'purchasePayments'
    const syncState = await fastify.prisma.tocSyncState.findFirst({
      where: { clientId, entityType: syncEntityType },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send({ syncing: true, data: [] })
    }

    const items = entityType === 'customer'
      ? await fastify.prisma.tocSalesReceipt.findMany({
          where: { clientId, tocId: { in: parsedIds } },
        })
      : await fastify.prisma.tocPurchasePayment.findMany({
          where: { clientId, tocId: { in: parsedIds } },
        })

    return reply.send(items.map(item => item.raw))
  })

  // ── Raw proxy (exploração de API — apenas admins) ─────────────────────────
  fastify.get('/toconline/:clientId/raw', { onRequest: [fastify.requireAdmin] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { path, ...rest } = request.query as { path: string; [k: string]: string }
    if (!path) return reply.status(400).send({ error: 'query param "path" é obrigatório' })
    const params = Object.keys(rest).length ? rest : undefined
    const t0 = Date.now()
    const data = await svc.rawGet(clientId, path, params)
    return reply.send({ _meta: { durationMs: Date.now() - t0, path, params: params ?? {} }, data })
  })

  fastify.get('/toconline/:clientId/customer-stats', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }

    // Faturas TOConline em aberto — status 1 (finalizado) ou 2 (parcial), com pendente > 0
    const tocRows = await fastify.prisma.tocSalesDocument.groupBy({
      by: ['customerId'],
      where: { clientId, pendingTotal: { gt: 0 }, status: { in: [1, 2] }, customerId: { not: null } },
      _count: { id: true },
      _sum: { pendingTotal: true },
    })

    // Faturas criadas localmente na tesouraria (origin = LOCAL, sem ligação a doc TOConline)
    const localRows = await fastify.prisma.treasuryReceivable.groupBy({
      by: ['tocCustomerId'],
      where: { clientId, origin: 'LOCAL', tocSalesDocId: null, status: { notIn: ['SETTLED', 'VOID'] }, tocCustomerId: { not: null } },
      _count: { id: true },
      _sum: { pendingAmount: true },
    })

    const map = new Map<number, { openCount: number; pendingAmount: number }>()
    for (const r of tocRows) {
      const id = r.customerId!
      map.set(id, { openCount: r._count.id, pendingAmount: Number(r._sum.pendingTotal ?? 0) })
    }
    for (const r of localRows) {
      const id = Number(r.tocCustomerId!)
      const cur = map.get(id) ?? { openCount: 0, pendingAmount: 0 }
      map.set(id, { openCount: cur.openCount + r._count.id, pendingAmount: cur.pendingAmount + Number(r._sum.pendingAmount ?? 0) })
    }

    return reply.send([...map.entries()].map(([tocId, s]) => ({ tocId, ...s })))
  })

  fastify.get('/toconline/:clientId/supplier-stats', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }

    // Faturas TOConline em aberto — status 1, 2 ou 5 (aberto em compras), com pendente > 0
    const tocRows = await fastify.prisma.tocPurchaseDocument.groupBy({
      by: ['supplierId'],
      where: { clientId, pendingTotal: { gt: 0 }, status: { in: [1, 2, 5] }, supplierId: { not: null } },
      _count: { id: true },
      _sum: { pendingTotal: true },
    })

    // Faturas criadas localmente (sem ligação a doc TOConline)
    const localRows = await fastify.prisma.treasuryPayable.groupBy({
      by: ['tocSupplierId'],
      where: { clientId, origin: 'LOCAL', tocPurchasesDocId: null, status: { notIn: ['SETTLED', 'VOID'] }, tocSupplierId: { not: null } },
      _count: { id: true },
      _sum: { pendingAmount: true },
    })

    const map = new Map<number, { openCount: number; pendingAmount: number }>()
    for (const r of tocRows) {
      const id = r.supplierId!
      map.set(id, { openCount: r._count.id, pendingAmount: Number(r._sum.pendingTotal ?? 0) })
    }
    for (const r of localRows) {
      const id = Number(r.tocSupplierId!)
      const cur = map.get(id) ?? { openCount: 0, pendingAmount: 0 }
      map.set(id, { openCount: cur.openCount + r._count.id, pendingAmount: cur.pendingAmount + Number(r._sum.pendingAmount ?? 0) })
    }

    return reply.send([...map.entries()].map(([tocId, s]) => ({ tocId, ...s })))
  })

  fastify.get('/toconline/:clientId/entity-local-docs', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { entityType, tocEntityId } = request.query as { entityType?: string; tocEntityId?: string }
    if (!entityType || !tocEntityId) return reply.status(400).send({ error: 'entityType and tocEntityId required' })

    const tocIdStr = String(tocEntityId)
    const tocIdNum = Number(tocEntityId)

    if (entityType === 'customer') {
      const docs = await fastify.prisma.treasuryReceivable.findMany({
        where: {
          clientId,
          origin: 'LOCAL',
          tocSalesDocId: null,
          tocCustomerId: tocIdStr,
          status: { notIn: ['SETTLED', 'VOID'] },
        },
        orderBy: { dueDate: 'desc' },
      })
      return reply.send(docs.map(d => ({
        id: `local-${d.id}`,
        document_no: d.reference ?? '—',
        document_type: 'LOCAL',
        status: d.status === 'PARTIAL' ? 2 : 1,
        date: d.documentDate?.toISOString().slice(0, 10) ?? d.dueDate?.toISOString().slice(0, 10) ?? null,
        due_date: d.dueDate?.toISOString().slice(0, 10) ?? null,
        gross_total: Number(d.totalAmount ?? 0),
        pending_total: Number(d.pendingAmount ?? 0),
        customer_id: tocIdNum,
        receipts_ids: [],
        _local: true,
        _description: d.description ?? null,
      })))
    } else {
      const docs = await fastify.prisma.treasuryPayable.findMany({
        where: {
          clientId,
          origin: 'LOCAL',
          tocPurchasesDocId: null,
          tocSupplierId: tocIdStr,
          status: { notIn: ['SETTLED', 'VOID'] },
        },
        orderBy: { dueDate: 'desc' },
      })
      return reply.send(docs.map(d => ({
        id: `local-${d.id}`,
        document_no: d.reference ?? '—',
        document_type: 'LOCAL',
        status: d.status === 'PARTIAL' ? 2 : 1,
        date: d.documentDate?.toISOString().slice(0, 10) ?? d.dueDate?.toISOString().slice(0, 10) ?? null,
        due_date: d.dueDate?.toISOString().slice(0, 10) ?? null,
        gross_total: Number(d.totalAmount ?? 0),
        pending_total: Number(d.pendingAmount ?? 0),
        supplier_id: tocIdNum,
        payments_ids: [],
        _local: true,
        _description: d.description ?? null,
      })))
    }
  })

  fastify.post('/toconline/:clientId/sync', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const result = await (fastify as any).tocScheduler.triggerSync(clientId)
    return reply.send(result)
  })

  fastify.get('/toconline/:clientId/sync-status', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const states = await fastify.prisma.tocSyncState.findMany({ where: { clientId } })
    return reply.send(states)
  })
}
