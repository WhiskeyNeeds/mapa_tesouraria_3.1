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
        categoryLinks: {
          include: { budgetCategory: { select: { id: true, name: true, color: true, type: true } } },
        },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    })

    const withProgress = await Promise.all(
      budgets.map(async (b) => ({
        ...b,
        totalAmount: Number(b.totalAmount.toString()),
        categories: b.categoryLinks.map((l) => l.budgetCategory),
        progress: await this.computeProgress(b.id, b.type, Number(b.totalAmount.toString())),
      })),
    )

    return withProgress
  }

  async getById(clientId: string, id: string) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        categoryLinks: {
          include: { budgetCategory: { select: { id: true, name: true, color: true, type: true } } },
        },
      },
    })
    if (!budget) throw httpError(404, 'Budget not found')

    const totalAmount = Number(budget.totalAmount.toString())
    const progress = await this.computeProgress(budget.id, budget.type, totalAmount)

    const linkedDocs = budget.type === 'REVENUE'
      ? await this.prisma.treasuryReceivable.findMany({
          where: { budgetId: id, deletedAt: null },
          include: { category: { select: { id: true, name: true, color: true } }, budgetCategory: { select: { id: true, name: true, color: true } } },
          orderBy: { dueDate: 'asc' },
        })
      : await this.prisma.treasuryPayable.findMany({
          where: { budgetId: id, deletedAt: null },
          include: { category: { select: { id: true, name: true, color: true } }, budgetCategory: { select: { id: true, name: true, color: true } } },
          orderBy: { dueDate: 'asc' },
        })

    return {
      ...budget,
      totalAmount,
      categories: budget.categoryLinks.map((l) => l.budgetCategory),
      progress,
      documents: linkedDocs,
    }
  }

  /**
   * Progresso de um budget:
   *  - Paid: total já recebido/pago efetivamente.
   *  - Expected: pendingAmount dos documentos em aberto ou parciais.
   *  - Available: totalAmount − (paid + expected). Pode ficar negativo (overrun).
   *  Documentos VOID/anulados são ignorados.
   */
  private async computeProgress(budgetId: string, type: TreasuryCategoryType, totalAmount: number): Promise<BudgetProgress> {
    if (type === 'REVENUE') {
      const docs = await this.prisma.treasuryReceivable.findMany({
        where: { budgetId, deletedAt: null, status: { not: 'VOID' } },
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
      where: { budgetId, deletedAt: null, status: { not: 'VOID' } },
      select: { paidAmount: true, pendingAmount: true },
    })
    const paidAmount = docs.reduce((s, d) => s + Number(d.paidAmount ?? 0), 0)
    const expectedAmount = docs.reduce((s, d) => s + Number(d.pendingAmount ?? 0), 0)
    const totalAllocated = paidAmount + expectedAmount
    const availableAmount = totalAmount - totalAllocated
    const overrunAmount = availableAmount < 0 ? -availableAmount : 0
    return { paidAmount, expectedAmount, availableAmount, totalAllocated, overrunAmount }
  }

  /**
   * Valida que todas as budgetCategoryIds pertencem ao cliente e têm o tipo esperado.
   */
  private async validateBudgetCategories(clientId: string, type: TreasuryCategoryType, budgetCategoryIds: string[] | undefined): Promise<string[]> {
    if (!budgetCategoryIds || budgetCategoryIds.length === 0) return []
    const unique = [...new Set(budgetCategoryIds)]
    const categories = await this.prisma.treasuryBudgetCategory.findMany({
      where: { id: { in: unique }, clientId, deletedAt: null },
      select: { id: true, name: true, type: true },
    })
    if (categories.length !== unique.length) {
      throw httpError(404, 'Uma ou mais categorias de budget não foram encontradas')
    }
    const wrongType = categories.find((c) => c.type !== type)
    if (wrongType) {
      throw httpError(400, `Categoria de budget '${wrongType.name}' é do tipo ${wrongType.type === 'REVENUE' ? 'Receita' : 'Despesa'} e não pode ser associada a um budget de ${type === 'REVENUE' ? 'Receitas' : 'Despesas'}`)
    }
    return unique
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
    budgetCategoryIds?: string[]
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

    const budgetCategoryIds = await this.validateBudgetCategories(clientId, data.type, data.budgetCategoryIds)

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
        ...(budgetCategoryIds.length > 0 ? {
          categoryLinks: { create: budgetCategoryIds.map((bcid) => ({ budgetCategoryId: bcid })) },
        } : {}),
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
        budgetCategoryIds,
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
    budgetCategoryIds: string[]
  }>) {
    const budget = await this.prisma.treasuryBudget.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!budget) throw httpError(404, 'Budget not found')

    const updateData: Prisma.TreasuryBudgetUpdateInput = {}
    if (data.name !== undefined) {
      const newName = data.name.trim()
      if (!newName) throw httpError(400, 'Nome é obrigatório')
      const clash = await this.prisma.treasuryBudget.findFirst({
        where: {
          clientId, deletedAt: null,
          name: { equals: newName, mode: 'insensitive' },
          NOT: { id },
        },
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.treasuryBudget.update({ where: { id }, data: updateData })
      if (data.budgetCategoryIds !== undefined) {
        const budgetCategoryIds = await this.validateBudgetCategories(clientId, budget.type, data.budgetCategoryIds)
        await tx.treasuryBudgetCategoryLink.deleteMany({ where: { budgetId: id } })
        if (budgetCategoryIds.length > 0) {
          await tx.treasuryBudgetCategoryLink.createMany({
            data: budgetCategoryIds.map((bcid) => ({ budgetId: id, budgetCategoryId: bcid })),
          })
        }
      }
      return result
    })

    const changes = diffEntity(
      budget as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    )
    if (Object.keys(changes).length > 0 || data.budgetCategoryIds !== undefined) {
      await audit(this.prisma, {
        clientId, userId,
        action: 'budget.update',
        entityType: 'Budget', entityId: id,
        payload: {
          changes,
          ...(data.budgetCategoryIds !== undefined ? { budgetCategoryIds: data.budgetCategoryIds } : {}),
        },
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

  /**
   * Verifica se o budget existe, pertence ao cliente e tem o tipo esperado.
   * Lança 404/400 caso contrário. Usado antes de associar doc à budgetId.
   */
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

  /**
   * Devolve o budgetId do único budget ativo (do tipo esperado) que tenha esta categoria de budget associada.
   * Devolve null se houver zero ou múltiplos (caso ambíguo — utilizador escolhe manualmente).
   */
  async findBudgetForBudgetCategory(clientId: string, budgetCategoryId: string, type: TreasuryCategoryType): Promise<string | null> {
    const matches = await this.prisma.treasuryBudget.findMany({
      where: {
        clientId,
        deletedAt: null,
        status: 'ACTIVE',
        type,
        categoryLinks: { some: { budgetCategoryId } },
      },
      select: { id: true },
      take: 2,
    })
    return matches.length === 1 ? matches[0].id : null
  }
}
