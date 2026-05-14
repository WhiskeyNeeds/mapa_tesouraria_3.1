import type { PrismaClient, LocalContactType, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class LocalContactsService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, type: LocalContactType, search?: string) {
    const where: Prisma.LocalContactWhereInput = {
      clientId,
      type,
      deletedAt: null,
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { nif: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    }
    return this.prisma.localContact.findMany({ where, orderBy: { name: 'asc' } })
  }

  async create(clientId: string, data: {
    type: LocalContactType
    name: string
    nif: string
    phone?: string
    mobile?: string
    email?: string
    address?: string
    notes?: string
  }) {
    if (!data.nif || !/^\d{9}$/.test(data.nif)) throw httpError(400, 'NIF deve ter exatamente 9 dígitos')
    if (data.phone && !/^\d{9}$/.test(data.phone)) throw httpError(400, 'Telefone deve ter exatamente 9 dígitos')
    if (data.mobile && !/^\d{9}$/.test(data.mobile)) throw httpError(400, 'Telemóvel deve ter exatamente 9 dígitos')
    return this.prisma.localContact.create({
      data: { clientId, ...data },
    })
  }

  async update(clientId: string, id: string, data: Partial<{
    name: string
    nif: string
    phone: string
    mobile: string
    email: string
    address: string
    notes: string
  }>) {
    const item = await this.prisma.localContact.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!item) throw httpError(404, 'Contact not found')
    if (data.nif !== undefined && !/^\d{9}$/.test(data.nif)) throw httpError(400, 'NIF deve ter exatamente 9 dígitos')
    if (data.phone !== undefined && data.phone !== '' && !/^\d{9}$/.test(data.phone)) throw httpError(400, 'Telefone deve ter exatamente 9 dígitos')
    if (data.mobile !== undefined && data.mobile !== '' && !/^\d{9}$/.test(data.mobile)) throw httpError(400, 'Telemóvel deve ter exatamente 9 dígitos')
    return this.prisma.localContact.update({ where: { id }, data })
  }

  async getDocCount(clientId: string, id: string) {
    const item = await this.prisma.localContact.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!item) throw httpError(404, 'Contact not found')
    const nameWhere = { entityName: { equals: item.name, mode: 'insensitive' as const } }
    const [receivables, payables] = await Promise.all([
      this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, tocSalesDocId: null, ...nameWhere },
      }),
      this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, tocPurchasesDocId: null, ...nameWhere },
      }),
    ])
    return { receivables, payables, total: receivables + payables }
  }

  async delete(clientId: string, id: string) {
    const item = await this.prisma.localContact.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!item) throw httpError(404, 'Contact not found')
    const nameWhere = { entityName: { equals: item.name, mode: 'insensitive' as const } }
    const now = new Date()
    await Promise.all([
      this.prisma.localContact.update({ where: { id }, data: { deletedAt: now } }),
      this.prisma.treasuryReceivable.updateMany({
        where: { clientId, deletedAt: null, tocSalesDocId: null, ...nameWhere },
        data: { deletedAt: now },
      }),
      this.prisma.treasuryPayable.updateMany({
        where: { clientId, deletedAt: null, tocPurchasesDocId: null, ...nameWhere },
        data: { deletedAt: now },
      }),
    ])
  }
}
