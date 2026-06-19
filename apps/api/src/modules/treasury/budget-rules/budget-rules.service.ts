import type { PrismaClient } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { audit } from '../../../lib/audit.js'

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

  async create(clientId: string, userId: string, data: { budgetId: string; categoryId: string; textPattern?: string }) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id: data.budgetId, clientId, deletedAt: null },
    })
    if (!budget) throw httpError(404, 'Budget não encontrado')
    if (budget.status !== 'ACTIVE') throw httpError(400, 'Só é possível criar regras em budgets activos')

    const category = await this.prisma.treasuryCategory.findFirst({
      where: { id: data.categoryId, clientId, deletedAt: null },
    })
    if (!category) throw httpError(404, 'Categoria não encontrada')

    if (category.type !== budget.type) {
      throw httpError(400, `A categoria '${category.name}' é do tipo ${category.type === 'REVENUE' ? 'Receita' : 'Despesa'} e o budget é do tipo ${budget.type === 'REVENUE' ? 'Receita' : 'Despesa'}`)
    }

    const normalizedPattern = data.textPattern?.trim() || null
    const clash = await this.prisma.treasuryBudgetRule.findFirst({
      where: {
        budgetId: data.budgetId,
        categoryId: data.categoryId,
        textPattern: normalizedPattern,
      },
    })
    if (clash) throw httpError(409, 'Já existe uma regra com esta combinação de categoria e filtro de texto')

    const rule = await this.prisma.treasuryBudgetRule.create({
      data: {
        clientId,
        budgetId: data.budgetId,
        categoryId: data.categoryId,
        textPattern: normalizedPattern,
      },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.rule_add',
      entityType: 'Budget', entityId: data.budgetId,
      payload: { ruleId: rule.id, categoryName: category.name, textPattern: normalizedPattern },
    })
    return rule
  }

  async update(clientId: string, id: string, data: { textPattern?: string | null }) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Regra não encontrada')

    const normalizedPattern = data.textPattern !== undefined ? (data.textPattern?.trim() || null) : rule.textPattern
    const clash = await this.prisma.treasuryBudgetRule.findFirst({
      where: {
        budgetId: rule.budgetId,
        categoryId: rule.categoryId,
        textPattern: normalizedPattern,
        NOT: { id },
      },
    })
    if (clash) throw httpError(409, 'Já existe uma regra com esta combinação de categoria e filtro de texto')

    return this.prisma.treasuryBudgetRule.update({
      where: { id },
      data: { textPattern: normalizedPattern },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
  }

  async delete(clientId: string, userId: string, id: string) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({
      where: { id, clientId },
      include: { category: { select: { name: true } } },
    })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    await this.prisma.treasuryBudgetRule.delete({ where: { id } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.rule_remove',
      entityType: 'Budget', entityId: rule.budgetId,
      payload: { ruleId: rule.id, categoryName: rule.category?.name ?? null, textPattern: rule.textPattern },
    })
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
