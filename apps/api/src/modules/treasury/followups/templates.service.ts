import type { PrismaClient, TreasuryEmailTemplateScope } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class EmailTemplatesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, scope?: TreasuryEmailTemplateScope) {
    return this.prisma.treasuryEmailTemplate.findMany({
      where: {
        clientId,
        deletedAt: null,
        isActive: true,
        ...(scope ? { OR: [{ scope }, { scope: 'BOTH' }] } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })
  }

  async getById(clientId: string, id: string) {
    const tpl = await this.prisma.treasuryEmailTemplate.findFirst({
      where: { id, clientId, deletedAt: null },
    })
    if (!tpl) throw httpError(404, 'Template não encontrado')
    return tpl
  }

  async create(clientId: string, createdById: string, data: {
    name: string
    scope?: TreasuryEmailTemplateScope
    subject: string
    bodyHtml: string
    isDefault?: boolean
  }) {
    if (data.isDefault) {
      await this.unsetDefaults(clientId, data.scope ?? 'BOTH')
    }
    return this.prisma.treasuryEmailTemplate.create({
      data: { clientId, createdById, ...data },
    })
  }

  async update(clientId: string, id: string, data: Partial<{
    name: string
    scope: TreasuryEmailTemplateScope
    subject: string
    bodyHtml: string
    isDefault: boolean
    isActive: boolean
  }>) {
    const existing = await this.getById(clientId, id)
    if (data.isDefault && !existing.isDefault) {
      await this.unsetDefaults(clientId, data.scope ?? existing.scope)
    }
    return this.prisma.treasuryEmailTemplate.update({ where: { id }, data })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryEmailTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    })
  }

  private async unsetDefaults(clientId: string, scope: TreasuryEmailTemplateScope) {
    await this.prisma.treasuryEmailTemplate.updateMany({
      where: {
        clientId,
        deletedAt: null,
        isDefault: true,
        OR: [{ scope }, { scope: 'BOTH' }],
      },
      data: { isDefault: false },
    })
  }
}
