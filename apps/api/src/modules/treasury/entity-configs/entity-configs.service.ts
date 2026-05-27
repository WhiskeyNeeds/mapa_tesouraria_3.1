import type { PrismaClient } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryEntityConfigsService {
  constructor(private prisma: PrismaClient) {}

  async get(clientId: string, entityType: string, tocEntityId: string) {
    this.validateEntityType(entityType)
    return this.prisma.treasuryEntityConfig.findUnique({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
      include: { category: { select: { id: true, name: true, color: true } } },
    })
  }

  async upsert(
    clientId: string,
    entityType: string,
    tocEntityId: string,
    data: { defaultCategoryId: string | null },
  ) {
    this.validateEntityType(entityType)

    if (data.defaultCategoryId) {
      const expectedType = entityType === 'supplier' ? 'EXPENSE' : 'REVENUE'
      const category = await this.prisma.treasuryCategory.findFirst({
        where: { id: data.defaultCategoryId, clientId, deletedAt: null },
      })
      if (!category) throw httpError(404, 'Categoria não encontrada')
      if (category.type !== expectedType) {
        const typeLabel = expectedType === 'EXPENSE' ? 'Despesa' : 'Receita'
        throw httpError(400, `A categoria deve ser do tipo ${typeLabel} para este tipo de entidade`)
      }
    }

    return this.prisma.treasuryEntityConfig.upsert({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
      create: {
        clientId,
        entityType,
        tocEntityId,
        defaultCategoryId: data.defaultCategoryId,
      },
      update: { defaultCategoryId: data.defaultCategoryId },
      include: { category: { select: { id: true, name: true, color: true } } },
    })
  }

  async delete(clientId: string, entityType: string, tocEntityId: string) {
    this.validateEntityType(entityType)
    const existing = await this.prisma.treasuryEntityConfig.findUnique({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
    })
    if (!existing) throw httpError(404, 'Configuração não encontrada')
    await this.prisma.treasuryEntityConfig.delete({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
    })
  }

  private validateEntityType(entityType: string) {
    if (entityType !== 'supplier' && entityType !== 'customer') {
      throw httpError(400, 'entityType deve ser "supplier" ou "customer"')
    }
  }
}
