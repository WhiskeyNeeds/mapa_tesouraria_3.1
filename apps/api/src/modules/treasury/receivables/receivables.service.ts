import type { PrismaClient, TreasuryDocStatus, TreasuryDocOrigin, TreasuryRecurrenceFrequency, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from '../recurrences/utils.js'

export class TreasuryReceivablesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, filters: {
    status?: TreasuryDocStatus | TreasuryDocStatus[]
    origin?: TreasuryDocOrigin
    categoryId?: string
    entityName?: string
    dueDateFrom?: string
    dueDateTo?: string
    docDateFrom?: string
    docDateTo?: string
    isRecurrent?: boolean
    overdue?: boolean
    tocCustomerId?: string
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, isRecurrent, overdue, tocCustomerId, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const effectiveStatusFilter = overdue
      ? { status: { in: ['OPEN', 'PARTIAL'] as TreasuryDocStatus[] } }
      : Array.isArray(status)
        ? status.length === 1 ? { status: status[0] } : { status: { in: status } }
        : status ? { status } : {}
    const where: Prisma.TreasuryReceivableWhereInput = {
      clientId,
      deletedAt: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...effectiveStatusFilter,
      ...(origin ? { origin } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(tocCustomerId ? { tocCustomerId } : {}),
      ...(entityName ? { OR: [
        { entityName: { contains: entityName, mode: 'insensitive' } },
        { reference: { contains: entityName, mode: 'insensitive' } },
      ] } : {}),
      ...(dueDateFrom || dueDateTo || overdue ? {
        dueDate: {
          ...(overdue ? { lt: new Date() } : {}),
          ...(dueDateFrom ? { gte: new Date(dueDateFrom) } : {}),
          ...(dueDateTo ? { lt: new Date(new Date(dueDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(docDateFrom || docDateTo ? {
        documentDate: {
          ...(docDateFrom ? { gte: new Date(docDateFrom) } : {}),
          ...(docDateTo ? { lt: new Date(new Date(docDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.treasuryReceivable.count({ where }),
      this.prisma.treasuryReceivable.findMany({
        where,
        include: { category: { select: { id: true, name: true, color: true, launchToc: true } } },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return { total, page, limit, items }
  }

  async getById(clientId: string, id: string) {
    const item = await this.prisma.treasuryReceivable.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        category: true,
        recurrence: true,
        reconciliationLinks: { include: { reconciliation: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
    if (!item) throw httpError(404, 'Receivable not found')
    return item
  }

  async create(clientId: string, userId: string, data: {
    categoryId?: string
    entityName?: string
    entityNif?: string
    tocCustomerId?: string
    tocSalesDocId?: string
    reference?: string
    description?: string
    documentDate?: string
    dueDate: string
    totalAmount: number
    currency?: string
    recurrenceId?: string
    recurrence?: { frequency: TreasuryRecurrenceFrequency; endDate?: string; occurrences?: number }
  }) {
    let category = null
    if (data.categoryId) {
      category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
    }

    if (data.tocSalesDocId) {
      const existing = await this.prisma.treasuryReceivable.findFirst({
        where: { clientId, tocSalesDocId: data.tocSalesDocId, deletedAt: null },
      })
      if (existing) throw httpError(409, `Documento ${data.reference ?? data.tocSalesDocId} já importado`)
    }

    let recurrenceId = data.recurrenceId

    if (data.recurrence) {
      const firstDueDate = new Date(data.dueDate)
      const rec = await this.prisma.treasuryRecurrence.create({
        data: {
          clientId,
          frequency: data.recurrence.frequency,
          startDate: firstDueDate,
          endDate: data.recurrence.endDate ? new Date(data.recurrence.endDate) : null,
          occurrences: data.recurrence.occurrences ?? null,
          nextRunAt: computeNextDate(firstDueDate, data.recurrence.frequency),
        },
      })
      recurrenceId = rec.id
    }

    return this.prisma.treasuryReceivable.create({
      data: {
        clientId,
        createdById: userId,
        origin: category?.launchToc ? 'TOCONLINE' : 'LOCAL',
        totalAmount: data.totalAmount,
        pendingAmount: data.totalAmount,
        documentDate: data.documentDate ? new Date(data.documentDate) : null,
        dueDate: new Date(data.dueDate),
        currency: data.currency ?? 'EUR',
        categoryId: data.categoryId,
        entityName: data.entityName ?? null,
        entityNif: data.entityNif,
        tocCustomerId: data.tocCustomerId,
        tocSalesDocId: data.tocSalesDocId,
        reference: data.reference ?? null,
        description: data.description,
        recurrenceId,
      },
    })
  }

  async update(clientId: string, id: string, data: Partial<{
    entityName: string
    description: string
    reference: string
    documentDate: string
    dueDate: string
    categoryId: string
    totalAmount: number
    status: TreasuryDocStatus
  }>) {
    const item = await this.getById(clientId, id)

    const updateData: Prisma.TreasuryReceivableUpdateInput = {}
    if (data.entityName   !== undefined) updateData.entityName   = data.entityName
    if (data.description  !== undefined) updateData.description  = data.description
    if (data.reference    !== undefined) updateData.reference    = data.reference
    if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
    if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
    if (data.status)                     updateData.status       = data.status

    if (data.categoryId) {
      const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
      updateData.category = { connect: { id: data.categoryId } }
      updateData.origin = category.launchToc ? 'TOCONLINE' : 'LOCAL'
    }

    if (data.totalAmount !== undefined) {
      if (item.status !== 'OPEN') throw httpError(409, 'Só é possível alterar o valor de documentos em aberto sem pagamentos')
      updateData.totalAmount = data.totalAmount
      updateData.pendingAmount = data.totalAmount
    }

    return this.prisma.treasuryReceivable.update({ where: { id }, data: updateData })
  }

  private async syncParentStatus(clientId: string, parentId: string) {
    const children = await this.prisma.treasuryReceivable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, receivedAmount: true, pendingAmount: true },
    })
    if (children.length === 0) return
    const receivedAmount = children.reduce((s, c) => s + Number(c.receivedAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const allSettled = children.every((c) => c.status === 'SETTLED')
    const someSettledOrPartial = children.some((c) => c.status === 'SETTLED' || c.status === 'PARTIAL')
    const status: TreasuryDocStatus = allSettled ? 'SETTLED' : someSettledOrPartial ? 'PARTIAL' : 'OPEN'
    await this.prisma.treasuryReceivable.update({ where: { id: parentId }, data: { status, receivedAmount, pendingAmount } })
  }

  async settle(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided receivable')
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { status: 'SETTLED', pendingAmount: 0, receivedAmount: item.totalAmount },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async unsettle(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status !== 'SETTLED') throw httpError(409, 'Apenas documentos liquidados podem ser revertidos')
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { status: 'OPEN', pendingAmount: item.totalAmount, receivedAmount: 0 },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async partialPayment(clientId: string, id: string, amount: number) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided receivable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    const newReceived = Number(item.receivedAmount ?? 0) + amount
    const newPending = Math.max(0, Number(item.totalAmount) - newReceived)
    const newStatus = newPending < 0.005 ? 'SETTLED' : 'PARTIAL'
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { receivedAmount: newReceived, pendingAmount: newPending, status: newStatus },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async void(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Cannot void a settled receivable')
    return this.prisma.treasuryReceivable.update({ where: { id }, data: { status: 'VOID' } })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryReceivable.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async setPromisedDate(clientId: string, id: string, date: string | null) {
    await this.getById(clientId, id)
    return this.prisma.treasuryReceivable.update({
      where: { id },
      data: { promisedPaymentDate: date ? new Date(date) : null },
    })
  }

  async split(clientId: string, userId: string, id: string, installments: Array<{ dueDate: string; amount: number; description?: string }>) {
    const item = await this.getById(clientId, id)
    if (item.status !== 'OPEN') throw httpError(409, 'Só é possível dividir documentos em aberto')
    if (item.parentId) throw httpError(409, 'Não é possível dividir uma parcela')
    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    if (splitChildren.length > 0) throw httpError(409, 'Esta fatura já está dividida')
    const total = installments.reduce((s, i) => s + i.amount, 0)
    if (Math.abs(total - Number(item.totalAmount)) > 0.001) throw httpError(400, 'A soma das parcelas não corresponde ao valor original')

    const children: unknown[] = []
    for (const inst of installments) {
      const idx: number = children.length + 1
      const child = await this.prisma.treasuryReceivable.create({
        data: {
          clientId,
          createdById: userId,
          origin: item.origin,
          categoryId: item.categoryId,
          entityName: item.entityName,
          entityNif: item.entityNif ?? undefined,
          tocCustomerId: item.tocCustomerId ?? undefined,
          tocSalesDocId: item.tocSalesDocId ?? undefined,
          reference: `${item.reference}-${idx}`,
          description: inst.description ?? item.description ?? undefined,
          documentDate: item.documentDate,
          dueDate: new Date(inst.dueDate),
          currency: item.currency,
          totalAmount: inst.amount,
          pendingAmount: inst.amount,
          parentId: id,
        },
      })
      children.push(child)
    }
    return children
  }

  async unsplit(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    if (splitChildren.length === 0) throw httpError(409, 'Este documento não tem parcelas para desfazer')
    const nonOpen = splitChildren.filter((c) => c.status !== 'OPEN')
    if (nonOpen.length > 0) throw httpError(409, 'Não é possível desfazer: algumas parcelas já foram pagas ou anuladas')
    await this.prisma.treasuryReceivable.deleteMany({ where: { parentId: id } })
    return this.prisma.treasuryReceivable.update({
      where: { id },
      data: { status: 'OPEN', receivedAmount: 0, pendingAmount: item.totalAmount },
    })
  }

  async deleteByTocCustomerId(clientId: string, tocCustomerId: string) {
    return this.prisma.treasuryReceivable.updateMany({
      where: { clientId, tocCustomerId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async getKpis(clientId: string) {
    const now = new Date()
    const [totalOpen, overdue, settledMonth] = await Promise.all([
      this.prisma.treasuryReceivable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
      }),
      this.prisma.treasuryReceivable.aggregate({
        where: {
          clientId, deletedAt: null, status: 'SETTLED',
          updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
        _sum: { totalAmount: true },
      }),
    ])

    // Aging buckets
    const buckets = await Promise.all([30, 60, 90].map(async (days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - days * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : (i === 2 ? 61 : 91))) * 86400000)
      return this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
      })
    }))

    return {
      totalPending: Number(totalOpen._sum.pendingAmount ?? 0),
      countOpen: totalOpen._count,
      countOverdue: overdue,
      settledThisMonth: Number(settledMonth._sum.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
    }
  }
}
