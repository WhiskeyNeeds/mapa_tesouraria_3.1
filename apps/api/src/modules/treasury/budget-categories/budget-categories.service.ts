import type { PrismaClient, TreasuryCategoryType, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryBudgetCategoriesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, filters: { type?: TreasuryCategoryType; includeArchived?: boolean } = {}) {
    const where: Prisma.TreasuryBudgetCategoryWhereInput = {
      clientId,
      deletedAt: null,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.includeArchived ? {} : { isArchived: false }),
    }
    const items = await this.prisma.treasuryBudgetCategory.findMany({
      where,
      include: {
        _count: { select: { receivables: true, payables: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
    return items.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      color: c.color,
      icon: c.icon,
      isArchived: c.isArchived,
      usageCount: c._count.receivables + c._count.payables,
    }))
  }

  async create(clientId: string, data: { name: string; type: TreasuryCategoryType; color?: string; icon?: string }) {
    const name = data.name?.trim()
    if (!name) throw httpError(400, 'Nome é obrigatório')
    if (!['REVENUE', 'EXPENSE'].includes(data.type)) throw httpError(400, 'Tipo inválido')
    const existing = await this.prisma.treasuryBudgetCategory.findFirst({
      where: { clientId, deletedAt: null, type: data.type, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) throw httpError(409, `Já existe uma categoria de budget '${name}' do tipo ${data.type === 'REVENUE' ? 'Receita' : 'Despesa'}`)
    return this.prisma.treasuryBudgetCategory.create({
      data: {
        clientId,
        name,
        type: data.type,
        color: data.color ?? null,
        icon: data.icon ?? null,
      },
    })
  }

  async update(clientId: string, id: string, data: Partial<{ name: string; color: string | null; icon: string | null; isArchived: boolean }>) {
    const item = await this.prisma.treasuryBudgetCategory.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!item) throw httpError(404, 'Categoria de budget não encontrada')

    const updateData: Prisma.TreasuryBudgetCategoryUpdateInput = {}
    if (data.name !== undefined) {
      const newName = data.name.trim()
      if (!newName) throw httpError(400, 'Nome é obrigatório')
      const clash = await this.prisma.treasuryBudgetCategory.findFirst({
        where: {
          clientId, deletedAt: null, type: item.type,
          name: { equals: newName, mode: 'insensitive' },
          NOT: { id },
        },
        select: { id: true },
      })
      if (clash) throw httpError(409, `Já existe uma categoria de budget '${newName}' do tipo ${item.type === 'REVENUE' ? 'Receita' : 'Despesa'}`)
      updateData.name = newName
    }
    if (data.color !== undefined) updateData.color = data.color
    if (data.icon !== undefined) updateData.icon = data.icon
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived

    return this.prisma.treasuryBudgetCategory.update({ where: { id }, data: updateData })
  }

  async delete(clientId: string, id: string) {
    const item = await this.prisma.treasuryBudgetCategory.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!item) throw httpError(404, 'Categoria de budget não encontrada')
    await this.prisma.treasuryBudgetCategory.update({ where: { id }, data: { deletedAt: new Date() } })
  }
}
