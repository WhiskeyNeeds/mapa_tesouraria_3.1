import type { FastifyInstance } from 'fastify'
import { TreasuryBankMovementsService } from './bank-movements.service.js'
import { parseStatementFile } from './parsers/index.js'
import type { SupportedBank } from './parsers/index.js'
import type { TreasuryMovementStatus } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export async function bankMovementsRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBankMovementsService(fastify.prisma)
  const prefix = '/treasury/:clientId/movements'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as {
      bankAccountId?: string
      status?: TreasuryMovementStatus
      dateFrom?: string
      dateTo?: string
      page?: string
      limit?: string
    }
    return reply.send(await svc.list(clientId, {
      ...q,
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    }))
  })

  fastify.get(`${prefix}/summary`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.query as { bankAccountId?: string }
    return reply.send(await svc.getSummary(clientId, bankAccountId))
  })

  // JSON import (pre-parsed movements)
  fastify.post(`${prefix}/import`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as {
      bankAccountId: string
      movements: Parameters<TreasuryBankMovementsService['importMovements']>[2]
      source: Parameters<TreasuryBankMovementsService['importMovements']>[3]
    }
    const result = await svc.importMovements(clientId, body.bankAccountId, body.movements, body.source, request.user.sub)
    return reply.status(201).send(result)
  })

  // File upload import (multipart: file + bankAccountId + bank)
  fastify.post(`${prefix}/upload`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }

    let bankAccountId = ''
    let bank = ''
    let fileBuffer: Buffer | null = null

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const chunks: Buffer[] = []
        for await (const chunk of part.file) chunks.push(chunk)
        fileBuffer = Buffer.concat(chunks)
      } else {
        if (part.fieldname === 'bankAccountId') bankAccountId = part.value as string
        if (part.fieldname === 'bank') bank = part.value as string
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) throw httpError(400, 'No file uploaded')
    if (!bankAccountId) throw httpError(400, 'bankAccountId is required')
    if (!bank) throw httpError(400, 'bank is required (CGD | BCP | BPI | Bankinter | Santander | NovoBanco)')

    let movements
    try {
      movements = parseStatementFile(fileBuffer, bank as SupportedBank)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Parse error'
      throw httpError(422, `Failed to parse ${bank} statement: ${msg}`)
    }

    if (movements.length === 0) throw httpError(422, 'No movements found in file')

    const result = await svc.importMovements(clientId, bankAccountId, movements, 'CSV_IMPORT', request.user.sub)
    return reply.status(201).send({ ...result, parsed: movements.length, bank })
  })

  fastify.patch(`${prefix}/:id/classify`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { categoryId } = request.body as { categoryId: string }
    return reply.send(await svc.classify(clientId, id, categoryId))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
