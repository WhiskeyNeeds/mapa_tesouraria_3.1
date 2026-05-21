import type { PrismaClient, TreasuryDocStatus, TreasuryDocOrigin, TreasuryRecurrenceFrequency, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from '../recurrences/utils.js'

export class TreasuryPayablesService {
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
    tocSupplierId?: string
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, isRecurrent, overdue, tocSupplierId, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const effectiveStatusFilter = overdue
      ? { status: { in: ['OPEN', 'PARTIAL'] as TreasuryDocStatus[] } }
      : Array.isArray(status)
        ? status.length === 1 ? { status: status[0] } : { status: { in: status } }
        : status ? { status } : {}
    const where: Prisma.TreasuryPayableWhereInput = {
      clientId,
      deletedAt: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...effectiveStatusFilter,
      ...(origin ? { origin } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(tocSupplierId ? { tocSupplierId } : {}),
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
      this.prisma.treasuryPayable.count({ where }),
      this.prisma.treasuryPayable.findMany({
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
    const item = await this.prisma.treasuryPayable.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        category: true,
        recurrence: true,
        reconciliationLinks: { include: { reconciliation: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
    if (!item) throw httpError(404, 'Payable not found')
    return item
  }

  async create(clientId: string, userId: string, data: {
    categoryId?: string
    entityName?: string
    entityNif?: string
    tocSupplierId?: string
    tocPurchasesDocId?: string
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

    if (data.tocPurchasesDocId) {
      const existing = await this.prisma.treasuryPayable.findFirst({
        where: { clientId, tocPurchasesDocId: data.tocPurchasesDocId, deletedAt: null },
      })
      if (existing) throw httpError(409, `Documento ${data.reference ?? data.tocPurchasesDocId} já importado`)
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

    return this.prisma.treasuryPayable.create({
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
        tocSupplierId: data.tocSupplierId,
        tocPurchasesDocId: data.tocPurchasesDocId,
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

    const updateData: Prisma.TreasuryPayableUpdateInput = {}
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

    return this.prisma.treasuryPayable.update({ where: { id }, data: updateData })
  }

  private async syncParentStatus(clientId: string, parentId: string) {
    const children = await this.prisma.treasuryPayable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, paidAmount: true, pendingAmount: true },
    })
    if (children.length === 0) return
    const paidAmount = children.reduce((s, c) => s + Number(c.paidAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const allSettled = children.every((c) => c.status === 'SETTLED')
    const someSettledOrPartial = children.some((c) => c.status === 'SETTLED' || c.status === 'PARTIAL')
    const status: TreasuryDocStatus = allSettled ? 'SETTLED' : someSettledOrPartial ? 'PARTIAL' : 'OPEN'
    await this.prisma.treasuryPayable.update({ where: { id: parentId }, data: { status, paidAmount, pendingAmount } })
  }

  async settle(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided payable')
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { status: 'SETTLED', pendingAmount: 0, paidAmount: item.totalAmount },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async unsettle(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status !== 'SETTLED') throw httpError(409, 'Apenas documentos liquidados podem ser revertidos')
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { status: 'OPEN', pendingAmount: item.totalAmount, paidAmount: 0 },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async partialPayment(clientId: string, id: string, amount: number) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided payable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    const newPaid = Number(item.paidAmount ?? 0) + amount
    const newPending = Math.max(0, Number(item.totalAmount) - newPaid)
    const newStatus = newPending < 0.005 ? 'SETTLED' : 'PARTIAL'
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { paidAmount: newPaid, pendingAmount: newPending, status: newStatus },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async void(clientId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Cannot void a settled payable')
    return this.prisma.treasuryPayable.update({ where: { id }, data: { status: 'VOID' } })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryPayable.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async setPromisedDate(clientId: string, id: string, date: string | null) {
    await this.getById(clientId, id)
    return this.prisma.treasuryPayable.update({
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
      const child = await this.prisma.treasuryPayable.create({
        data: {
          clientId,
          createdById: userId,
          origin: item.origin,
          categoryId: item.categoryId,
          entityName: item.entityName,
          entityNif: item.entityNif ?? undefined,
          tocSupplierId: item.tocSupplierId ?? undefined,
          tocPurchasesDocId: item.tocPurchasesDocId ?? undefined,
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
    await this.prisma.treasuryPayable.deleteMany({ where: { parentId: id } })
    return this.prisma.treasuryPayable.update({
      where: { id },
      data: { status: 'OPEN', paidAmount: 0, pendingAmount: item.totalAmount },
    })
  }

  async deleteByTocSupplierId(clientId: string, tocSupplierId: string) {
    return this.prisma.treasuryPayable.updateMany({
      where: { clientId, tocSupplierId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async getKpis(clientId: string) {
    const now = new Date()
    const [totalOpen, overdue, paidMonth] = await Promise.all([
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: 'SETTLED', updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
        _sum: { totalAmount: true },
      }),
    ])

    const buckets = await Promise.all([30, 60, 90].map(async (days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - days * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : (i === 2 ? 61 : 91))) * 86400000)
      return this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
      })
    }))

    return {
      totalPending: Number(totalOpen._sum.pendingAmount ?? 0),
      countOpen: totalOpen._count,
      countOverdue: overdue,
      paidThisMonth: Number(paidMonth._sum.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
    }
  }
}
