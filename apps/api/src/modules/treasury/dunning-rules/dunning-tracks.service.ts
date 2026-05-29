import type { PrismaClient, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export interface DunningTrackInput {
  name: string
  isActive?: boolean
  isDefault?: boolean
  sortOrder?: number
}

export class TreasuryDunningTracksService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string) {
    return this.prisma.treasuryDunningTrack.findMany({
      where: { clientId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { rules: { where: { deletedAt: null } }, assignments: true } },
      },
    })
  }

  async getById(clientId: string, id: string) {
    const t = await this.prisma.treasuryDunningTrack.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        rules: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { offsetDays: 'asc' }],
          include: {
            emailTemplate: { select: { id: true, name: true, scope: true } },
            category: { select: { id: true, name: true, color: true, type: true } },
          },
        },
        _count: { select: { rules: { where: { deletedAt: null } }, assignments: true } },
      },
    })
    if (!t) throw httpError(404, 'Régua não encontrada')
    return t
  }

  async create(clientId: string, data: DunningTrackInput) {
    if (!data.name?.trim()) throw httpError(400, 'Nome é obrigatório')

    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.treasuryDunningTrack.updateMany({
          where: { clientId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        })
      }
      return tx.treasuryDunningTrack.create({
        data: {
          clientId,
          name: data.name.trim(),
          isActive: data.isActive ?? true,
          isDefault: data.isDefault ?? false,
          sortOrder: data.sortOrder ?? 100,
        },
      })
    })
  }

  async update(clientId: string, id: string, data: Partial<DunningTrackInput>) {
    const t = await this.prisma.treasuryDunningTrack.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!t) throw httpError(404, 'Régua não encontrada')

    return this.prisma.$transaction(async (tx) => {
      // Se está a tornar-se default, despromove o atual default.
      if (data.isDefault === true && !t.isDefault) {
        await tx.treasuryDunningTrack.updateMany({
          where: { clientId, deletedAt: null, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        })
      }

      const update: Prisma.TreasuryDunningTrackUpdateInput = {}
      if (data.name !== undefined) {
        const n = data.name.trim()
        if (!n) throw httpError(400, 'Nome é obrigatório')
        update.name = n
      }
      if (data.isActive !== undefined) update.isActive = data.isActive
      if (data.isDefault !== undefined) update.isDefault = data.isDefault
      if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder

      return tx.treasuryDunningTrack.update({ where: { id }, data: update })
    })
  }

  async delete(clientId: string, id: string) {
    const t = await this.prisma.treasuryDunningTrack.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!t) throw httpError(404, 'Régua não encontrada')
    if (t.isDefault) throw httpError(400, 'Não é possível eliminar a régua marcada como default. Marca outra como default primeiro.')

    await this.prisma.treasuryDunningTrack.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    })
  }

  /**
   * Resolve a régua aplicável a um receivable: primeiro procura uma atribuição
   * explícita por `tocCustomerId`; se não houver, devolve a régua default do
   * tenant. Devolve `null` se não existir nenhuma (sem default configurado).
   */
  async resolveForReceivable(clientId: string, tocCustomerId: string | null) {
    if (tocCustomerId) {
      const assignment = await this.prisma.treasuryDunningTrackAssignment.findUnique({
        where: { clientId_tocCustomerId: { clientId, tocCustomerId } },
        include: { track: true },
      })
      if (assignment && !assignment.track.deletedAt && assignment.track.isActive) {
        return assignment.track
      }
    }
    return this.prisma.treasuryDunningTrack.findFirst({
      where: { clientId, deletedAt: null, isDefault: true, isActive: true },
    })
  }

  // ── Assignments ────────────────────────────────────────────────────────

  async listAssignments(clientId: string) {
    return this.prisma.treasuryDunningTrackAssignment.findMany({
      where: { clientId },
      include: { track: { select: { id: true, name: true, isActive: true, isDefault: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getAssignmentForCustomer(clientId: string, tocCustomerId: string) {
    return this.prisma.treasuryDunningTrackAssignment.findUnique({
      where: { clientId_tocCustomerId: { clientId, tocCustomerId } },
      include: { track: { select: { id: true, name: true, isActive: true, isDefault: true } } },
    })
  }

  async setAssignment(clientId: string, tocCustomerId: string, trackId: string | null) {
    if (!tocCustomerId?.trim()) throw httpError(400, 'tocCustomerId obrigatório')

    if (trackId === null) {
      // Remover atribuição → cai no default.
      await this.prisma.treasuryDunningTrackAssignment.deleteMany({
        where: { clientId, tocCustomerId },
      })
      return { trackId: null }
    }

    const track = await this.prisma.treasuryDunningTrack.findFirst({
      where: { id: trackId, clientId, deletedAt: null },
    })
    if (!track) throw httpError(404, 'Régua não encontrada')

    return this.prisma.treasuryDunningTrackAssignment.upsert({
      where: { clientId_tocCustomerId: { clientId, tocCustomerId } },
      create: { clientId, tocCustomerId, trackId },
      update: { trackId },
    })
  }
}
