import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryCategoriesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, type?: TreasuryCategoryType, includeArchived = false) {
    const [categories, movementCounts] = await Promise.all([
      this.prisma.treasuryCategory.findMany({
        where: { clientId, deletedAt: null, ...(includeArchived ? {} : { isArchived: false }), ...(type ? { type } : {}) },
        orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
        include: { children: { where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { children: { where: { deletedAt: null }, orderBy: { name: 'asc' } } } } },
      }),
      this.prisma.treasuryBankMovement.groupBy({
        by: ['categoryId'],
        where: { clientId, deletedAt: null, categoryId: { not: null } },
        _count: { id: true },
      }),
    ])
    const countMap = new Map(movementCounts.map((c) => [c.categoryId, c._count.id]))
    return categories.map((cat) => ({ ...cat, usageCount: countMap.get(cat.id) ?? 0 }))
  }

  async getById(clientId: string, id: string) {
    const cat = await this.prisma.treasuryCategory.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!cat) throw httpError(404, 'Category not found')
    return cat
  }

  async create(clientId: string, data: {
    name: string
    type: TreasuryCategoryType
    tocExpenseCategoryId?: string
    tocTaxDescriptorId?: string
    color?: string
    icon?: string
    parentId?: string
  }) {
    if (data.parentId) {
      const parent = await this.prisma.treasuryCategory.findFirst({ where: { id: data.parentId, clientId, deletedAt: null } })
      if (!parent) throw httpError(404, 'Parent category not found')
    }
    // launchToc forçado a false: a app já não dispara escritas no TOC pelo
    // frontend; mantém-se a coluna na BD para integração futura.
    return this.prisma.treasuryCategory.create({ data: { clientId, ...data, launchToc: false } })
  }

  async update(clientId: string, id: string, data: Partial<{
    name: string
    tocExpenseCategoryId: string
    color: string
    icon: string
    isArchived: boolean
    parentId: string | null
  }>) {
    await this.getById(clientId, id)
    if (data.parentId) {
      const parent = await this.prisma.treasuryCategory.findFirst({ where: { id: data.parentId, clientId, deletedAt: null } })
      if (!parent) throw httpError(404, 'Parent category not found')
      if (data.parentId === id) throw httpError(400, 'Category cannot be its own parent')
    }
    return this.prisma.treasuryCategory.update({ where: { id }, data })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryCategory.update({ where: { id }, data: { deletedAt: new Date() } })
  }
}
