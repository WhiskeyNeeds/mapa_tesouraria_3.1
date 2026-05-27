import type { FastifyInstance } from 'fastify'
import { TreasuryReceivablesService } from './receivables.service.js'
import { ToconlineService } from '../../toconline/toconline.service.js'
import type { TreasuryDocStatus, TreasuryDocOrigin } from '@prisma/client'

interface TocDocLine {
  item_type: 'Service' | 'Product'
  description: string
  quantity: number
  unit_price: number
  tax_code: 'NOR' | 'INT' | 'RED' | 'ISE'
}

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
      docDateFrom?: string
      docDateTo?: string
      isRecurrent?: string
      overdue?: string
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
      overdue: q.overdue === 'true',
      docDateFrom: q.docDateFrom,
      docDateTo: q.docDateTo,
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

  fastify.post(`${prefix}/apply-rules`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.applyRulesToExisting(clientId))
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
    const body = request.body as Parameters<TreasuryReceivablesService['create']>[2] & {
      tocLines?: TocDocLine[]
      tocDocumentType?: string
      taxExemptionCode?: string
      vatIncludedPrices?: boolean
      retentionPct?: number
    }

    let tocSalesDocId = body.tocSalesDocId
    let tocCustomerId = body.tocCustomerId
    let reference = body.reference

    if (body.tocLines && body.tocLines.length > 0) {
      const tocSvc = new ToconlineService(fastify.prisma)

      // tax_exemption_reason_id pode ser necessário para linhas ISE
      let taxExemptionReasonId: number | undefined
      const hasIse = body.tocLines.some((l) => l.tax_code === 'ISE')
      if (hasIse && body.taxExemptionCode) {
        taxExemptionReasonId = await tocSvc.getTaxExemptionReasonId(clientId, body.taxExemptionCode)
      }

      const tocDoc = await tocSvc.createSalesDocument(clientId, {
        document_type: body.tocDocumentType ?? 'FT',
        date: body.documentDate,
        due_date: body.dueDate,
        customer_business_name: body.entityName,
        ...(body.entityNif ? { customer_tax_registration_number: body.entityNif } : {}),
        ...(body.description ? { notes: body.description } : {}),
        ...(body.reference ? { external_reference: body.reference } : {}),
        ...(taxExemptionReasonId ? { tax_exemption_reason_id: taxExemptionReasonId } : {}),
        ...(body.vatIncludedPrices ? { vat_included_prices: true } : {}),
        ...(body.retentionPct != null && body.retentionPct > 0 ? { retention_percentage: body.retentionPct } : {}),
        lines: body.tocLines.map((l) => ({
          item_type: l.item_type,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          tax_code: l.tax_code,
        })),
      }) as Record<string, unknown>

      const dataObj = tocDoc?.data as Record<string, unknown> | undefined
      const attrs = dataObj?.attributes as Record<string, unknown> | undefined
      tocSalesDocId = String(dataObj?.id ?? tocDoc?.id ?? '')
      const docNo = String(attrs?.document_no ?? tocDoc?.document_no ?? '')
      if (docNo) reference = docNo

      // Extrai o customer.id do relationship (necessário para associar emails de
      // cobrança ao cliente correto na vista de Empresa → Clientes).
      const rels = dataObj?.relationships as Record<string, unknown> | undefined
      const customerRel = rels?.customer as { data?: { id?: string | number } } | undefined
      const customerIdFromToc = customerRel?.data?.id
      if (customerIdFromToc != null && !tocCustomerId) {
        tocCustomerId = String(customerIdFromToc)
      }

      const grossTotal = Number(attrs?.gross_total ?? tocDoc?.gross_total)
      if (grossTotal > 0) body.totalAmount = grossTotal
    }

    return reply.status(201).send(await svc.create(clientId, request.user.sub, {
      ...body,
      reference: reference || body.reference,
      tocSalesDocId,
      tocCustomerId,
    }))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryReceivablesService['update']>[3]
    return reply.send(await svc.update(clientId, request.user.sub, id, body))
  })

  fastify.post(`${prefix}/:id/settle`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.settle(clientId, request.user.sub, id))
  })

  fastify.post(`${prefix}/:id/unsettle`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.unsettle(clientId, request.user.sub, id))
  })

  fastify.post(`${prefix}/:id/partial-payment`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { amount } = request.body as { amount: number }
    return reply.send(await svc.partialPayment(clientId, request.user.sub, id, amount))
  })

  fastify.post(`${prefix}/:id/void`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.void(clientId, request.user.sub, id))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, request.user.sub, id)
    return reply.status(204).send()
  })

  fastify.delete(`${prefix}/by-customer/:tocCustomerId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, tocCustomerId } = request.params as { clientId: string; tocCustomerId: string }
    await svc.deleteByTocCustomerId(clientId, tocCustomerId)
    return reply.status(204).send()
  })

  fastify.patch(`${prefix}/:id/promised-date`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { date } = request.body as { date: string | null }
    return reply.send(await svc.setPromisedDate(clientId, request.user.sub, id, date))
  })

  fastify.post(`${prefix}/:id/split`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { installments } = request.body as { installments: Array<{ dueDate: string; amount: number; description?: string }> }
    return reply.status(201).send(await svc.split(clientId, request.user.sub, id, installments))
  })

  fastify.post(`${prefix}/:id/unsplit`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await svc.unsplit(clientId, request.user.sub, id))
  })
}
