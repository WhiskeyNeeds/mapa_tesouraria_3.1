import type { FastifyInstance } from 'fastify'
import { TreasuryReceivablesService } from './receivables.service.js'
import type { TreasuryDocStatus, TreasuryDocOrigin } from '@prisma/client'

export async function receivablesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryReceivablesService(fastify.prisma)
  const prefix = '/treasury/:clientId/receivables'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as {
      status?: string
      origin?: TreasuryDocOrigin
      categoryId?: string
      entityName?: string
      dueDateFrom?: string
      dueDateTo?: string
      isRecurrent?: string
      tocCustomerId?: string
      sortBy?: string
      sortDir?: string
      page?: string
      limit?: string
    }
    const statusValue = q.status?.includes(',')
      ? (q.status.split(',') as TreasuryDocStatus[])
      : (q.status as TreasuryDocStatus | undefined)
    const validSortBy = ['dueDate', 'totalAmount', 'pendingAmount', 'entityName'].includes(q.sortBy ?? '') ? q.sortBy as 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName' : undefined
    const validSortDir = q.sortDir === 'asc' || q.sortDir === 'desc' ? q.sortDir : undefined
    return reply.send(await svc.list(clientId, {
      ...q,
      status: statusValue,
      isRecurrent: q.isRecurrent !== undefined ? q.isRecurrent === 'true' : undefined,
      sortBy: validSortBy,
      sortDir: validSortDir,
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    }))
  })

  fastify.get(`${prefix}/kpis`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getKpis(clientId))
  })

  fastify.get(`${prefix}/export.csv`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { status?: string; origin?: TreasuryDocOrigin; entityName?: string; categoryId?: string; dueDateFrom?: string; dueDateTo?: string }
    const statusValue = q.status?.includes(',')
      ? (q.status.split(',') as TreasuryDocStatus[])
      : (q.status as TreasuryDocStatus | undefined)
    const { items } = await svc.list(clientId, { status: statusValue, origin: q.origin, entityName: q.entityName, categoryId: q.categoryId, dueDateFrom: q.dueDateFrom, dueDateTo: q.dueDateTo, limit: 10000, page: 1 })
    const header = 'Documento;Cliente;NIF;Categoria;Data Doc.;Vencimento;Total;Pendente;Recebido;Estado;Origem\n'
    const pt = (n: number) => n.toFixed(2).replace('.', ',')
    const rows = items.map((r) => [
      r.reference,
      r.entityName,
      r.entityNif ?? '',
      r.category?.name ?? '',
      r.documentDate instanceof Date ? r.documentDate.toISOString().slice(0, 10) : String(r.documentDate),
      r.dueDate instanceof Date ? r.dueDate.toISOString().slice(0, 10) : String(r.dueDate),
      pt(Number(r.totalAmount)),
      pt(Number(r.pendingAmount)),
      pt(Number(r.receivedAmount ?? 0)),
      r.status,
      r.origin,
    ].join(';')).join('\n')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="contas-a-receber.csv"')
    return reply.send('﻿' + header + rows)
  })

  fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.getById(clientId, id))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryReceivablesService['create']>[2]
    return reply.status(201).send(await svc.create(clientId, request.user.sub, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryReceivablesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.post(`${prefix}/:id/settle`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.settle(clientId, id))
  })

  fastify.post(`${prefix}/:id/partial-payment`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { amount } = request.body as { amount: number }
    return reply.send(await svc.partialPayment(clientId, id, amount))
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

  fastify.delete(`${prefix}/by-customer/:tocCustomerId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, tocCustomerId } = request.params as { clientId: string; tocCustomerId: string }
    await svc.deleteByTocCustomerId(clientId, tocCustomerId)
    return reply.status(204).send()
  })
}
