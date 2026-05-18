import { createHash } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { TreasuryBankMovementsService } from './bank-movements.service.js'
import { parseStatementFile, parsePDF } from './parsers/index.js'
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
      status?: string
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
    const statusValue = q.status?.includes(',')
      ? (q.status.split(',') as TreasuryMovementStatus[])
      : (q.status as TreasuryMovementStatus | undefined)
    return reply.send(await svc.list(clientId, {
      ...q,
      status: statusValue,
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

  // File upload preview — parse and validate without importing
  fastify.post(`${prefix}/upload/preview`, { onRequest: auth }, async (request, reply) => {
    const { clientId: _clientId } = request.params as { clientId: string }

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
        if (part.fieldname === 'bank') bank = part.value as string
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) throw httpError(400, 'No file uploaded')
    if (!bank) throw httpError(400, 'bank is required')

    const isPDF = originalFileName?.toLowerCase().endsWith('.pdf') ||
      (fileBuffer.length >= 4 && fileBuffer.slice(0, 4).toString('ascii') === '%PDF')

    let movements: Awaited<ReturnType<typeof parsePDF>>
    try {
      movements = isPDF
        ? await parsePDF(fileBuffer, bank as SupportedBank)
        : parseStatementFile(fileBuffer, bank as SupportedBank)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar ficheiro'
      return reply.status(422).send({ error: msg })
    }

    if (movements.length === 0) return reply.status(422).send({ error: 'Nenhum movimento encontrado no ficheiro.' })

    type Issue = { row: number; field: string; message: string }
    const issues: Issue[] = []
    let prevBalance: number | null = null

    for (let i = 0; i < movements.length; i++) {
      const m = movements[i]
      const row = i + 1

      if (!m.date || !/^\d{4}-\d{2}-\d{2}$/.test(m.date))
        issues.push({ row, field: 'Data', message: 'Data em falta ou inválida' })

      if (!m.description?.trim())
        issues.push({ row, field: 'Descrição', message: 'Descrição em falta' })

      if (isNaN(m.amount) || m.amount === 0)
        issues.push({ row, field: 'Valor', message: 'Valor em falta ou igual a zero' })

      if (m.balanceAfter != null && prevBalance !== null && !isNaN(m.amount)) {
        const expected = Math.round((prevBalance + m.amount) * 100) / 100
        if (Math.abs(expected - m.balanceAfter) > 0.02)
          issues.push({
            row,
            field: 'Saldo pós movimento',
            message: `Saldo inconsistente: esperado ${expected.toFixed(2)} €, tem ${m.balanceAfter.toFixed(2)} €`,
          })
      }

      if (m.balanceAfter != null && !isNaN(m.balanceAfter)) prevBalance = m.balanceAfter
    }

    return reply.send({ parsed: movements.length, issues })
  })

  // File upload import (multipart: file + bankAccountId + bank)
  fastify.post(`${prefix}/upload`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { force } = request.query as { force?: string }

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
    if (!bank) throw httpError(400, 'bank is required (CGD | BCP | BPI | Bankinter | Santander | NovoBanco | TEMPLATE)')

    // Check if account already has imported movements
    const existingCount = await fastify.prisma.treasuryBankMovement.count({
      where: { clientId, bankAccountId, deletedAt: null, source: { not: 'MANUAL' } },
    })
    if (existingCount > 0 && force !== 'true') {
      return reply.status(409).send({
        code: 'ACCOUNT_HAS_IMPORTS',
        error: `Esta conta já tem ${existingCount} movimento(s) importado(s).`,
        existingCount,
      })
    }
    // Replace mode: soft-delete all existing imported movements before importing
    if (existingCount > 0 && force === 'true') {
      await fastify.prisma.treasuryBankMovement.updateMany({
        where: { clientId, bankAccountId, deletedAt: null, source: { not: 'MANUAL' } },
        data: { deletedAt: new Date() },
      })
    }

    const isPDF = originalFileName?.toLowerCase().endsWith('.pdf') ||
      (fileBuffer.length >= 4 && fileBuffer.slice(0, 4).toString('ascii') === '%PDF')

    // File-level duplicate check (account-scoped)
    const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
    const existingImport = await fastify.prisma.treasuryBankImport.findFirst({
      where: {
        clientId,
        bankAccountId,
        fileSha256,
        status: { in: ['PENDING', 'PROCESSING', 'DONE'] },
        bankAccount: { deletedAt: null, isActive: true },
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
        bankAccount: { deletedAt: null, isActive: true },
      },
      select: { createdAt: true, originalFileName: true, bankAccount: { select: { name: true } } },
    })
    if (importedInAnotherAccount) {
      const when = importedInAnotherAccount.createdAt.toLocaleDateString('pt-PT')
      const fileName = importedInAnotherAccount.originalFileName ? ` ("${importedInAnotherAccount.originalFileName}")` : ''
      const accountName = importedInAnotherAccount.bankAccount?.name ?? 'outra conta'
      return reply.status(409).send({ error: `Este ficheiro${fileName} já foi importado na conta "${accountName}" em ${when}.` })
    }

    let movements: Awaited<ReturnType<typeof parsePDF>>
    try {
      movements = isPDF
        ? await parsePDF(fileBuffer, bank as SupportedBank)
        : parseStatementFile(fileBuffer, bank as SupportedBank)
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

  // Unified account history: timeline + reconciliations + monthly summary
  fastify.get(`${prefix}/history`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.query as { bankAccountId?: string }
    if (!bankAccountId) throw httpError(400, 'bankAccountId is required')

    const [account, auditEntries, reconciliations, movements] = await Promise.all([
      fastify.prisma.treasuryBankAccount.findFirst({
        where: { id: bankAccountId, clientId },
        select: { id: true, name: true, bankName: true, createdAt: true, openingBalance: true, ibanLast4: true },
      }),
      // Audit log entries related to this account (by payload.bankAccountId or entityId)
      fastify.prisma.treasuryAuditLog.findMany({
        where: {
          clientId,
          OR: [
            { payload: { path: ['bankAccountId'], equals: bankAccountId } },
            { entityType: 'BankAccount', entityId: bankAccountId },
          ],
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      // Reconciliations linked to movements of this account
      fastify.prisma.treasuryReconciliation.findMany({
        where: {
          clientId,
          movements: { some: { movement: { bankAccountId, deletedAt: null } } },
        },
        include: {
          createdBy: { select: { name: true } },
          reversedBy: { select: { name: true } },
          movements: {
            include: { movement: { select: { date: true, amount: true, description: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // All non-deleted movements for monthly summary
      fastify.prisma.treasuryBankMovement.findMany({
        where: { clientId, bankAccountId, deletedAt: null },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
    ])

    if (!account) throw httpError(404, 'Bank account not found')

    // Build timeline
    const timeline = auditEntries.map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>
      return {
        id: e.id,
        entityId: e.entityId,
        type: e.action,
        date: e.createdAt,
        user: e.user?.name ?? null,
        payload: p,
      }
    })

    // Build monthly summary
    const monthMap = new Map<string, { income: number; expense: number }>()
    for (const m of movements) {
      const key = m.date.toISOString().slice(0, 7) // "YYYY-MM"
      const entry = monthMap.get(key) ?? { income: 0, expense: 0 }
      const amt = Number(m.amount)
      if (amt > 0) entry.income += amt
      else entry.expense += Math.abs(amt)
      monthMap.set(key, entry)
    }
    const monthlySummary = Array.from(monthMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, data]) => ({
        month,
        income: Math.round(data.income * 100) / 100,
        expense: Math.round(data.expense * 100) / 100,
        net: Math.round((data.income - data.expense) * 100) / 100,
      }))

    const reconSummary = reconciliations.map((r) => ({
      id: r.id,
      status: r.status,
      isDryRun: r.isDryRun,
      direction: r.direction,
      totalMovements: Number(r.totalMovements),
      totalAllocated: Number(r.totalAllocated),
      createdAt: r.createdAt,
      createdBy: r.createdBy.name,
      reversedAt: r.reversedAt,
      reversedBy: r.reversedBy?.name ?? null,
      reversedReason: r.reversedReason,
      movementsCount: r.movements.length,
    }))

    return reply.send({
      account: { ...account, openingBalance: Number(account.openingBalance) },
      timeline,
      reconciliations: reconSummary,
      monthlySummary,
    })
  })

  // Import history for a bank account
  fastify.get(`${prefix}/imports`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.query as { bankAccountId?: string }
    if (!bankAccountId) throw httpError(400, 'bankAccountId is required')

    const imports = await fastify.prisma.treasuryBankImport.findMany({
      where: { clientId, bankAccountId, status: { in: ['DONE', 'PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { movements: { where: { deletedAt: null } } } },
      },
    })

    return reply.send(imports.map((imp) => ({
      id: imp.id,
      originalFileName: imp.originalFileName,
      createdAt: imp.createdAt,
      rowsImported: imp.rowsImported,
      rowsDuplicated: imp.rowsDuplicated,
      rowsFailed: imp.rowsFailed,
      createdBy: imp.createdBy.name,
      activeMovements: imp._count.movements,
    })))
  })

  // Revert a specific import (soft-delete its active movements)
  fastify.delete(`${prefix}/imports/:importId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, importId } = request.params as { clientId: string; importId: string }

    const imp = await fastify.prisma.treasuryBankImport.findFirst({
      where: { id: importId, clientId },
    })
    if (!imp) throw httpError(404, 'Import not found')

    const { count } = await fastify.prisma.treasuryBankMovement.updateMany({
      where: { clientId, importId, deletedAt: null },
      data: { deletedAt: new Date() },
    })

    await fastify.prisma.treasuryAuditLog.create({
      data: {
        clientId, userId: request.user.sub,
        action: 'import.revert', entityType: 'BankImport', entityId: importId,
        payload: { reverted: count, bankAccountId: imp.bankAccountId },
      },
    })

    return reply.send({ reverted: count })
  })

  fastify.post(`${prefix}/apply-rules`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.applyRulesToExisting(clientId))
  })

  fastify.post(`${prefix}/deduplicate`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.body as { bankAccountId?: string }
    const result = await svc.deduplicateMovements(clientId, bankAccountId)
    if (result.removed > 0) {
      await fastify.prisma.treasuryAuditLog.create({
        data: {
          clientId, userId: request.user.sub, action: 'account.deduplicate', entityType: 'BankAccount',
          entityId: bankAccountId ?? null,
          payload: { bankAccountId: bankAccountId ?? null, removed: result.removed },
        },
      })
    }
    return reply.send(result)
  })

  fastify.get(`${prefix}/balance-check`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { bankAccountId } = request.query as { bankAccountId?: string }
    return reply.send(await svc.checkBalanceConsistency(clientId, bankAccountId))
  })

  fastify.get(`${prefix}/:id/reconciliations`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const movement = await fastify.prisma.treasuryBankMovement.findFirst({
      where: { id, clientId, deletedAt: null },
      select: { id: true },
    })
    if (!movement) throw httpError(404, 'Movement not found')

    const links = await fastify.prisma.treasuryReconciliationMovement.findMany({
      where: { movementId: id },
      include: {
        reconciliation: {
          include: {
            receivables: {
              include: {
                receivable: { select: { id: true, reference: true, entityName: true } },
              },
            },
            payables: {
              include: {
                payable: { select: { id: true, reference: true, entityName: true } },
              },
            },
          },
        },
      },
    })

    return reply.send(links)
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { description } = request.body as { description?: string }
    if (description === undefined) throw httpError(400, 'description is required')
    return reply.send(await svc.updateDescription(clientId, id, description, request.user.sub))
  })

  // Restore a soft-deleted movement
  fastify.patch(`${prefix}/:id/restore`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }

    const mov = await fastify.prisma.treasuryBankMovement.findFirst({
      where: { id, clientId, deletedAt: { not: null } },
    })
    if (!mov) throw httpError(404, 'Movimento eliminado não encontrado')

    await fastify.prisma.treasuryBankMovement.update({
      where: { id },
      data: { deletedAt: null },
    })

    await fastify.prisma.treasuryAuditLog.create({
      data: {
        clientId, userId: request.user.sub, action: 'movement.restore', entityType: 'BankMovement', entityId: id,
        payload: { bankAccountId: mov.bankAccountId, amount: Number(mov.amount) },
      },
    })

    return reply.send({ restored: true })
  })

  fastify.patch(`${prefix}/:id/classify`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const { categoryId } = request.body as { categoryId: string | null }
    return reply.send(await svc.classify(clientId, id, categoryId))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id, request.user.sub)
    return reply.status(204).send()
  })
}
