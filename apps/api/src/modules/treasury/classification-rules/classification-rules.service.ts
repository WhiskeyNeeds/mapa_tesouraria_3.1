import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryClassificationRulesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string) {
    return this.prisma.treasuryClassificationRule.findMany({
      where: { clientId },
      include: { category: { select: { id: true, name: true, color: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async create(clientId: string, data: {
    matchField: string
    matchOp: string
    matchValue: string
    amountMin?: number
    amountMax?: number
    direction?: TreasuryCategoryType
    categoryId: string
    priority?: number
  }) {
    return this.prisma.treasuryClassificationRule.create({ data: { clientId, ...data } })
  }

  async update(clientId: string, id: string, data: Partial<Parameters<TreasuryClassificationRulesService['create']>[1] & { isActive: boolean }>) {
    const rule = await this.prisma.treasuryClassificationRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Rule not found')
    return this.prisma.treasuryClassificationRule.update({ where: { id }, data })
  }

  async delete(clientId: string, id: string) {
    const rule = await this.prisma.treasuryClassificationRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Rule not found')
    return this.prisma.treasuryClassificationRule.delete({ where: { id } })
  }
}
