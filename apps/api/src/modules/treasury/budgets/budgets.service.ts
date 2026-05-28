// apps/api/src/modules/treasury/budgets/budgets.service.ts
import type { PrismaClient, TreasuryCategoryType, TreasuryBudgetStatus, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { audit, diffEntity } from '../../../lib/audit.js'

export interface BudgetProgress {
  paidAmount: number
  expectedAmount: number
  availableAmount: number
  totalAllocated: number
  overrunAmount: number
}

export class TreasuryBudgetsService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, filters: { status?: TreasuryBudgetStatus; type?: TreasuryCategoryType } = {}) {
    const where: Prisma.TreasuryBudgetWhereInput = {
      clientId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    }

    const budgets = await this.prisma.treasuryBudget.findMany({
      where,
      include: {
        rules: {
          include: { category: { select: { id: true, name: true, color: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    })

    const withProgress = await Promise.all(
      budgets.map(async (b) => {
        const pendingReviewCount = b.type === 'REVENUE'
          ? await this.prisma.treasuryReceivable.count({ where: { budgetId: b.id, budgetAutoAssigned: true, deletedAt: null } })
          : await this.prisma.treasuryPayable.count({ where: { budgetId: b.id, budgetAutoAssigned: true, deletedAt: null } })
        return {
          ...b,
          totalAmount: Number(b.totalAmount.toString()),
          progress: await this.computeProgress(b.id, b.type, Number(b.totalAmount.toString())),
          pendingReviewCount,
        }
      }),
    )

    return withProgress
  }

  async getById(clientId: string, id: string) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        rules: {
          include: {
            category: { select: { id: true, name: true, color: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!budget) throw httpError(404, 'Budget not found')

    const totalAmount = Number(budget.totalAmount.toString())
    const progress = await this.computeProgress(budget.id, budget.type, totalAmount)

    const docWhere = { budgetId: id, deletedAt: null, NOT: { recurrenceId: { not: null as string | null }, parentId: null } }
    const docInclude = { category: { select: { id: true, name: true, color: true } } }
    const docOrder = [{ dueDate: 'asc' as const }]

    const documents = budget.type === 'REVENUE'
      ? await this.prisma.treasuryReceivable.findMany({ where: docWhere, include: docInclude, orderBy: docOrder })
      : await this.prisma.treasuryPayable.findMany({ where: docWhere, include: docInclude, orderBy: docOrder })

    return {
      ...budget,
      totalAmount,
      progress,
      documents,
    }
  }

  private async computeProgress(budgetId: string, type: TreasuryCategoryType, totalAmount: number): Promise<BudgetProgress> {
    // Recurrence template roots (parentId=null, recurrenceId set) are excluded — only actual
    // transaction instances (children) count. Old-style roots (pendingAmount>0) are still
    // counted because they predate the template convention.
    const excludeTemplates = { recurrenceId: { not: null as string | null }, parentId: null }

    if (type === 'REVENUE') {
      const docs = await this.prisma.treasuryReceivable.findMany({
        where: { budgetId, deletedAt: null, status: { not: 'VOID' }, NOT: excludeTemplates },
        select: { receivedAmount: true, pendingAmount: true },
      })
      const paidAmount = docs.reduce((s, d) => s + Number(d.receivedAmount ?? 0), 0)
      const expectedAmount = docs.reduce((s, d) => s + Number(d.pendingAmount ?? 0), 0)
      const totalAllocated = paidAmount + expectedAmount
      const availableAmount = totalAmount - totalAllocated
      const overrunAmount = availableAmount < 0 ? -availableAmount : 0
      return { paidAmount, expectedAmount, availableAmount, totalAllocated, overrunAmount }
    }

    const docs = await this.prisma.treasuryPayable.findMany({
      where: { budgetId, deletedAt: null, status: { not: 'VOID' }, NOT: excludeTemplates },
      select: { paidAmount: true, pendingAmount: true },
    })
    const paidAmount = docs.reduce((s, d) => s + Number(d.paidAmount ?? 0), 0)
    const expectedAmount = docs.reduce((s, d) => s + Number(d.pendingAmount ?? 0), 0)
    const totalAllocated = paidAmount + expectedAmount
    const availableAmount = totalAmount - totalAllocated
    const overrunAmount = availableAmount < 0 ? -availableAmount : 0
    return { paidAmount, expectedAmount, availableAmount, totalAllocated, overrunAmount }
  }

  async create(clientId: string, userId: string, data: {
    name: string
    description?: string
    type: TreasuryCategoryType
    totalAmount: number
    startDate: string
    endDate: string
    currency?: string
    color?: string
    icon?: string
  }) {
    if (!data.name?.trim()) throw httpError(400, 'Nome é obrigatório')
    if (!(data.totalAmount > 0)) throw httpError(400, 'Valor do budget tem de ser positivo')
    const start = new Date(data.startDate)
    const end = new Date(data.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError(400, 'Datas inválidas')
    if (end < start) throw httpError(400, 'Data de fim tem de ser igual ou posterior à data de início')

    const name = data.name.trim()
    const existing = await this.prisma.treasuryBudget.findFirst({
      where: { clientId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) throw httpError(409, `Já existe um budget com o nome "${name}"`)

    const created = await this.prisma.treasuryBudget.create({
      data: {
        clientId,
        createdById: userId,
        name,
        description: data.description?.trim() || null,
        type: data.type,
        totalAmount: data.totalAmount,
        currency: data.currency ?? 'EUR',
        startDate: start,
        endDate: end,
        color: data.color ?? null,
        icon: data.icon ?? null,
      },
    })

    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.create',
      entityType: 'Budget', entityId: created.id,
      payload: {
        name: created.name,
        type: created.type,
        totalAmount: Number(created.totalAmount.toString()),
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
      },
    })

    return created
  }

  async update(clientId: string, userId: string, id: string, data: Partial<{
    name: string
    description: string | null
    totalAmount: number
    startDate: string
    endDate: string
    color: string | null
    icon: string | null
    status: TreasuryBudgetStatus
  }>) {
    const budget = await this.prisma.treasuryBudget.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!budget) throw httpError(404, 'Budget not found')

    const updateData: Prisma.TreasuryBudgetUpdateInput = {}
    if (data.name !== undefined) {
      const newName = data.name.trim()
      if (!newName) throw httpError(400, 'Nome é obrigatório')
      const clash = await this.prisma.treasuryBudget.findFirst({
        where: { clientId, deletedAt: null, name: { equals: newName, mode: 'insensitive' }, NOT: { id } },
        select: { id: true },
      })
      if (clash) throw httpError(409, `Já existe um budget com o nome "${newName}"`)
      updateData.name = newName
    }
    if (data.description !== undefined) updateData.description = data.description?.trim() || null
    if (data.totalAmount !== undefined) {
      if (!(data.totalAmount > 0)) throw httpError(400, 'Valor do budget tem de ser positivo')
      updateData.totalAmount = data.totalAmount
    }
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate)
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate)
    if (data.color !== undefined) updateData.color = data.color
    if (data.icon !== undefined) updateData.icon = data.icon
    if (data.status !== undefined) updateData.status = data.status

    const updated = await this.prisma.treasuryBudget.update({ where: { id }, data: updateData })

    const changes = diffEntity(
      budget as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    )
    if (Object.keys(changes).length > 0) {
      await audit(this.prisma, {
        clientId, userId,
        action: 'budget.update',
        entityType: 'Budget', entityId: id,
        payload: { changes },
      })
    }

    return updated
  }

  async delete(clientId: string, userId: string, id: string) {
    const budget = await this.prisma.treasuryBudget.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!budget) throw httpError(404, 'Budget not found')
    await this.prisma.treasuryBudget.update({ where: { id }, data: { deletedAt: new Date() } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.delete',
      entityType: 'Budget', entityId: id,
      payload: { name: budget.name, totalAmount: Number(budget.totalAmount.toString()) },
    })
  }

  async assertCompatible(clientId: string, budgetId: string, expectedType: TreasuryCategoryType) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id: budgetId, clientId, deletedAt: null },
    })
    if (!budget) throw httpError(404, 'Budget não encontrado')
    if (budget.type !== expectedType) {
      throw httpError(400, `Budget '${budget.name}' é do tipo ${budget.type === 'REVENUE' ? 'Receitas' : 'Despesas'} e não pode ser associado a este documento`)
    }
    if (budget.status === 'ARCHIVED') {
      throw httpError(400, `Budget '${budget.name}' está arquivado`)
    }
  }
}
