// apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts
import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export interface BudgetSuggestion {
  budgetId: string
  budgetName: string
  ruleDescription: string
}

export class TreasuryBudgetRulesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, budgetId?: string) {
    const rules = await this.prisma.treasuryBudgetRule.findMany({
      where: { clientId, ...(budgetId ? { budgetId } : {}) },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ budgetId: 'asc' }, { createdAt: 'desc' }],
    })
    return rules
  }

  async create(clientId: string, data: { budgetId: string; categoryId: string; textPattern?: string }) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id: data.budgetId, clientId, deletedAt: null },
    })
    if (!budget) throw httpError(404, 'Budget não encontrado')

    const category = await this.prisma.treasuryCategory.findFirst({
      where: { id: data.categoryId, clientId, deletedAt: null },
    })
    if (!category) throw httpError(404, 'Categoria não encontrada')

    if (category.type !== budget.type) {
      throw httpError(400, `A categoria '${category.name}' é do tipo ${category.type === 'REVENUE' ? 'Receita' : 'Despesa'} e o budget é do tipo ${budget.type === 'REVENUE' ? 'Receita' : 'Despesa'}`)
    }

    return this.prisma.treasuryBudgetRule.create({
      data: {
        clientId,
        budgetId: data.budgetId,
        categoryId: data.categoryId,
        textPattern: data.textPattern?.trim() || null,
      },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
  }

  async update(clientId: string, id: string, data: { textPattern?: string | null }) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    return this.prisma.treasuryBudgetRule.update({
      where: { id },
      data: { textPattern: data.textPattern?.trim() || null },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
  }

  async delete(clientId: string, id: string) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    await this.prisma.treasuryBudgetRule.delete({ where: { id } })
  }

  async suggest(
    clientId: string,
    categoryId: string | null | undefined,
    text?: string,
  ): Promise<BudgetSuggestion | null> {
    if (!categoryId) return null

    const rules = await this.prisma.treasuryBudgetRule.findMany({
      where: {
        clientId,
        categoryId,
        budget: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        budget: { select: { id: true, name: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (rules.length === 0) return null

    const textLower = (text ?? '').toLowerCase()

    const specific = rules.filter(
      (r) => r.textPattern && textLower.includes(r.textPattern.toLowerCase()),
    )
    const winner = specific[0] ?? rules.find((r) => !r.textPattern) ?? null

    if (!winner) return null

    return {
      budgetId: winner.budget.id,
      budgetName: winner.budget.name,
      ruleDescription: winner.textPattern
        ? `${winner.category.name} + "${winner.textPattern}"`
        : winner.category.name,
    }
  }
}
