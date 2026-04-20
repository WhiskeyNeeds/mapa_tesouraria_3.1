import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryCategoriesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, type?: TreasuryCategoryType) {
    return this.prisma.treasuryCategory.findMany({
      where: { clientId, deletedAt: null, isArchived: false, ...(type ? { type } : {}) },
      orderBy: { name: 'asc' },
    })
  }

  async getById(clientId: string, id: string) {
    const cat = await this.prisma.treasuryCategory.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!cat) throw httpError(404, 'Category not found')
    return cat
  }

  async create(clientId: string, data: {
    name: string
    type: TreasuryCategoryType
    launchToc?: boolean
    tocExpenseCategoryId?: string
    tocTaxDescriptorId?: string
    color?: string
    icon?: string
  }) {
    return this.prisma.treasuryCategory.create({ data: { clientId, ...data } })
  }

  async update(clientId: string, id: string, data: Partial<{
    name: string
    launchToc: boolean
    tocExpenseCategoryId: string
    color: string
    icon: string
    isArchived: boolean
  }>) {
    await this.getById(clientId, id)
    return this.prisma.treasuryCategory.update({ where: { id }, data })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryCategory.update({ where: { id }, data: { deletedAt: new Date() } })
  }
}
