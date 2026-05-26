import type { FastifyInstance } from 'fastify'
import type {
  TreasuryEmailTemplateScope,
  TreasuryFollowupDirection,
  TreasuryFollowupImportance,
  TreasuryFollowupKind,
  TreasuryFollowupStatus,
} from '@prisma/client'
import { FollowupsService } from './followups.service.js'
import { EmailTemplatesService } from './templates.service.js'
import { InvoiceAttachmentsService } from './attachments.service.js'
import { ToconlineService } from '../../toconline/toconline.service.js'
import { variableHint } from './variables.js'
import { httpError } from '../../../lib/errors.js'

export async function followupsRoutes(fastify: FastifyInstance) {
  const toconline = new ToconlineService(fastify.prisma)
  const followups = new FollowupsService(fastify.prisma, toconline)
  const templates = new EmailTemplatesService(fastify.prisma)
  const attachments = new InvoiceAttachmentsService(fastify.prisma)

  const auth = [fastify.authenticate, fastify.requireClientAccess]
  const base = '/treasury/:clientId'

  // ── Variáveis disponíveis nos templates ──────────────────────────────
  fastify.get(`${base}/followups/variables`, { onRequest: auth }, async () => {
    return { variables: variableHint() }
  })

  // ── Timeline ─────────────────────────────────────────────────────────
  fastify.get(`${base}/followups`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as {
      receivableId?: string
      payableId?: string
      kind?: TreasuryFollowupKind
      status?: TreasuryFollowupStatus
      direction?: TreasuryFollowupDirection
    }
    return followups.list(clientId, q)
  })

  // Timeline unificada (followups + audit log)
  fastify.get(`${base}/activity`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { receivableId?: string; payableId?: string }
    return followups.getActivity(clientId, q)
  })

  fastify.get(`${base}/followups/:id`, { onRequest: auth }, async (request) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return followups.getById(clientId, id)
  })

  fastify.patch(`${base}/followups/:id`, { onRequest: auth }, async (request) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<FollowupsService['update']>[2]
    return followups.update(clientId, id, body)
  })

  fastify.delete(`${base}/followups/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await followups.delete(clientId, id)
    return reply.status(204).send()
  })

  // ── Enviar email ─────────────────────────────────────────────────────
  fastify.post(`${base}/followups/email`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<FollowupsService['sendEmailFollowup']>[2]
    return followups.sendEmailFollowup(clientId, request.user.sub, body)
  })

  // ── Criar tarefa de chamada ──────────────────────────────────────────
  fastify.post(`${base}/followups/call-task`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<FollowupsService['createCallTask']>[2]
    return followups.createCallTask(clientId, request.user.sub, body)
  })

  // ── Registar chamada efetuada ────────────────────────────────────────
  fastify.post(`${base}/followups/log-call`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<FollowupsService['logCall']>[2]
    return followups.logCall(clientId, request.user.sub, body)
  })

  // ── Adicionar nota livre ─────────────────────────────────────────────
  fastify.post(`${base}/followups/note`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<FollowupsService['addNote']>[2]
    return followups.addNote(clientId, request.user.sub, body)
  })

  // ── Email templates ─────────────────────────────────────────────────
  fastify.get(`${base}/email-templates`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const { scope } = request.query as { scope?: TreasuryEmailTemplateScope }
    return templates.list(clientId, scope)
  })

  fastify.get(`${base}/email-templates/:id`, { onRequest: auth }, async (request) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return templates.getById(clientId, id)
  })

  fastify.post(`${base}/email-templates`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<EmailTemplatesService['create']>[2]
    return reply.status(201).send(await templates.create(clientId, request.user.sub, body))
  })

  fastify.patch(`${base}/email-templates/:id`, { onRequest: auth }, async (request) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<EmailTemplatesService['update']>[2]
    return templates.update(clientId, id, body)
  })

  fastify.delete(`${base}/email-templates/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await templates.delete(clientId, id)
    return reply.status(204).send()
  })

  // ── Invoice attachments ─────────────────────────────────────────────
  fastify.get(`${base}/invoice-attachments`, { onRequest: auth }, async (request) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { receivableId?: string; payableId?: string }
    return attachments.list(clientId, q)
  })

  fastify.post(`${base}/invoice-attachments`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }

    let receivableId: string | undefined
    let payableId: string | undefined
    let filename = 'invoice.pdf'
    let mimeType = 'application/pdf'
    let buffer: Buffer | null = null

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        filename = part.filename || filename
        mimeType = part.mimetype || mimeType
        const chunks: Buffer[] = []
        for await (const chunk of part.file) chunks.push(chunk)
        buffer = Buffer.concat(chunks)
      } else {
        if (part.fieldname === 'receivableId') receivableId = part.value as string
        if (part.fieldname === 'payableId') payableId = part.value as string
      }
    }

    if (!buffer || buffer.length === 0) throw httpError(400, 'Ficheiro não enviado')
    const created = await attachments.create(clientId, request.user.sub, {
      receivableId,
      payableId,
      filename,
      mimeType,
      buffer,
    })
    return reply.status(201).send(created)
  })

  fastify.get(`${base}/invoice-attachments/:id/download`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { record, content } = await attachments.getFile(clientId, id)
    return reply
      .header('Content-Type', record.mimeType)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(record.filename)}"`)
      .send(content)
  })

  fastify.delete(`${base}/invoice-attachments/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await attachments.delete(clientId, id)
    return reply.status(204).send()
  })

  // ── PDF TOConline (preview/download direto) ──────────────────────────
  fastify.get(`${base}/toc-invoice-pdf/:direction/:tocDocId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, direction, tocDocId } = request.params as {
      clientId: string
      direction: 'RECEIVABLE' | 'PAYABLE'
      tocDocId: string
    }
    if (direction !== 'RECEIVABLE' && direction !== 'PAYABLE') {
      throw httpError(400, 'direction deve ser RECEIVABLE ou PAYABLE')
    }
    const pdf = await toconline.downloadInvoicePdf(clientId, direction, tocDocId)
    if (!pdf) throw httpError(404, 'PDF indisponível (documento finalizado?)')
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="invoice-${tocDocId}.pdf"`)
      .send(pdf)
  })
}
