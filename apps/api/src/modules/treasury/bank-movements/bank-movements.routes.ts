import { createHash } from 'crypto'
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
      categoryId?: string
      dateFrom?: string
      dateTo?: string
      search?: string
      direction?: 'income' | 'expense'
      sortBy?: 'date' | 'amount' | 'description' | 'balanceAfter'
      sortDir?: 'asc' | 'desc'
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
    const q = request.query as {
      bankAccountId?: string; dateFrom?: string; dateTo?: string; search?: string
      direction?: 'income' | 'expense'; status?: TreasuryMovementStatus; categoryId?: string
    }
    return reply.send(await svc.getSummary(clientId, q))
  })

  fastify.get(`${prefix}/export.csv`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as {
      bankAccountId?: string; status?: TreasuryMovementStatus; categoryId?: string; dateFrom?: string
      dateTo?: string; search?: string; direction?: 'income' | 'expense'
    }
    const { items } = await svc.list(clientId, { ...q, limit: 10000, page: 1 })

    const header = 'Data;Conta;Descrição;Categoria;Valor;Saldo\n'
    const rows = items.map((m) => {
      const dateStr = m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date)
      const ba = (m as unknown as { bankAccount?: { name: string } }).bankAccount
      const cat = (m as unknown as { category?: { name: string } }).category
      return [
        dateStr,
        ba?.name ?? '',
        `"${(m.description ?? '').replace(/"/g, '""')}"`,
        cat?.name ?? '',
        Number(m.amount).toFixed(2).replace('.', ','),
        m.balanceAfter != null ? Number(m.balanceAfter).toFixed(2).replace('.', ',') : '',
      ].join(';')
    }).join('\n')

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="movimentos.csv"')
    return reply.send('﻿' + header + rows)
  })

  // Manual movement creation
  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as { bankAccountId?: string; date?: string; amount?: number; description?: string }
    if (!body.bankAccountId) throw httpError(400, 'bankAccountId is required')
    if (!body.date) throw httpError(400, 'date is required')
    if (body.amount == null) throw httpError(400, 'amount is required')
    if (!body.description?.trim()) throw httpError(400, 'description is required')
    const result = await svc.createManual(clientId, {
      bankAccountId: body.bankAccountId,
      date: body.date,
      amount: body.amount,
      description: body.description,
    }, request.user.sub)
    return reply.status(201).send(result)
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
    let originalFileName: string | null = null

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        originalFileName = part.filename ?? null
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

    // File-level duplicate check (account-scoped)
    const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
    const existingImport = await fastify.prisma.treasuryBankImport.findFirst({
      where: {
        clientId,
        bankAccountId,
        fileSha256,
        status: { in: ['PENDING', 'PROCESSING', 'DONE'] },
      },
      select: { id: true, createdAt: true, originalFileName: true, bankAccount: { select: { name: true } } },
    })
    if (existingImport) {
      const when = existingImport.createdAt.toLocaleDateString('pt-PT')
      const fileName = existingImport.originalFileName ? ` ("${existingImport.originalFileName}")` : ''
      const accountName = existingImport.bankAccount?.name ? ` na conta "${existingImport.bankAccount.name}"` : ''
      return reply.status(409).send({ error: `Este ficheiro${fileName} já foi importado${accountName} em ${when}.` })
    }

    // Cross-account duplicate check: same file already imported in another account
    const importedInAnotherAccount = await fastify.prisma.treasuryBankImport.findFirst({
      where: {
        clientId,
        fileSha256,
        NOT: { bankAccountId },
        status: { in: ['PENDING', 'PROCESSING', 'DONE'] },
      },
      select: { createdAt: true, originalFileName: true, bankAccount: { select: { name: true } } },
    })
    if (importedInAnotherAccount) {
      const when = importedInAnotherAccount.createdAt.toLocaleDateString('pt-PT')
      const fileName = importedInAnotherAccount.originalFileName ? ` ("${importedInAnotherAccount.originalFileName}")` : ''
      const accountName = importedInAnotherAccount.bankAccount?.name ?? 'outra conta'
      return reply.status(409).send({ error: `Este ficheiro${fileName} já foi importado na conta "${accountName}" em ${when}.` })
    }

    let movements: ReturnType<typeof parseStatementFile>
    try {
      movements = parseStatementFile(fileBuffer, bank as SupportedBank)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar ficheiro'
      return reply.status(422).send({ error: msg })
    }

    if (movements.length === 0) return reply.status(422).send({ error: 'No movements found in file' })

    // Create import record
    const importRecord = await fastify.prisma.treasuryBankImport.create({
      data: {
        clientId,
        bankAccountId,
        source: 'CSV_IMPORT',
        originalFileName,
        fileSha256,
        fileSize: fileBuffer.length,
        status: 'PENDING',
        rowsTotal: movements.length,
        createdById: request.user.sub,
        startedAt: new Date(),
      },
    })

    const result = await svc.importMovements(clientId, bankAccountId, movements, 'CSV_IMPORT', request.user.sub, importRecord.id)

    // Update import record with result
    await fastify.prisma.treasuryBankImport.update({
      where: { id: importRecord.id },
      data: {
        status: 'DONE',
        rowsImported: result.imported,
        rowsDuplicated: result.duplicated,
        rowsFailed: result.failed,
        completedAt: new Date(),
      },
    })

    await fastify.prisma.treasuryAuditLog.create({
      data: {
        clientId, userId: request.user.sub,
        action: 'import.complete', entityType: 'BankImport', entityId: importRecord.id,
        payload: { bank, bankAccountId, parsed: movements.length, imported: result.imported, duplicated: result.duplicated, failed: result.failed },
      },
    })

    return reply.status(201).send({ ...result, parsed: movements.length, bank })
  })

  fastify.post(`${prefix}/apply-rules`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.applyRulesToExisting(clientId))
  })

  fastify.post(`${prefix}/deduplicate`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.body as { bankAccountId?: string }
    const result = await svc.deduplicateMovements(clientId, bankAccountId)
    return reply.send(result)
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { description } = request.body as { description?: string }
    if (description === undefined) throw httpError(400, 'description is required')
    return reply.send(await svc.updateDescription(clientId, id, description))
  })

  fastify.patch(`${prefix}/:id/classify`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { categoryId } = request.body as { categoryId: string }
    return reply.send(await svc.classify(clientId, id, categoryId))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id, request.user.sub)
    return reply.status(204).send()
  })
}
