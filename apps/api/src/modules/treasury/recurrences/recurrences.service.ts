import type { PrismaClient } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from './utils.js'

export class TreasuryRecurrencesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string) {
    const recurrences = await this.prisma.treasuryRecurrence.findMany({
      where: { clientId },
      include: {
        receivables: {
          where: { deletedAt: null, parentId: null },
          take: 1,
          include: { category: { select: { name: true, color: true } } },
        },
        payables: {
          where: { deletedAt: null, parentId: null },
          take: 1,
          include: { category: { select: { name: true, color: true } } },
        },
        _count: { select: { receivables: true, payables: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return recurrences.map((r) => {
      const isReceivable = r.receivables.length > 0
      const root = isReceivable ? r.receivables[0] : r.payables[0]
      return {
        id: r.id,
        frequency: r.frequency,
        startDate: r.startDate,
        endDate: r.endDate,
        occurrences: r.occurrences,
        nextRunAt: r.nextRunAt,
        lastRunAt: r.lastRunAt,
        isActive: r.isActive,
        type: isReceivable ? 'receivable' : 'payable',
        entityName: root?.entityName ?? '',
        reference: root?.reference ?? '',
        totalAmount: root ? Number(root.totalAmount) : 0,
        category: root ? (root as { category: { name: string; color: string } | null }).category : null,
        instanceCount: isReceivable ? r._count.receivables : r._count.payables,
      }
    })
  }

  async getById(clientId: string, id: string) {
    const r = await this.prisma.treasuryRecurrence.findFirst({
      where: { id, clientId },
      include: {
        receivables: {
          where: { deletedAt: null },
          orderBy: { dueDate: 'asc' },
          include: { category: { select: { name: true, color: true } } },
        },
        payables: {
          where: { deletedAt: null },
          orderBy: { dueDate: 'asc' },
          include: { category: { select: { name: true, color: true } } },
        },
      },
    })
    if (!r) throw httpError(404, 'Recurrence not found')
    return r
  }

  async deactivate(clientId: string, id: string) {
    const r = await this.prisma.treasuryRecurrence.findFirst({ where: { id, clientId } })
    if (!r) throw httpError(404, 'Recurrence not found')
    return this.prisma.treasuryRecurrence.update({ where: { id }, data: { isActive: false } })
  }

  async processForClient(clientId: string, horizonDays = 180): Promise<{ created: number }> {
    const now = new Date()
    const horizon = new Date(Date.now() + horizonDays * 86400000)

    // Backfill budgetId on existing children that inherit from a root with a budgetId
    const payableRoots = await this.prisma.treasuryPayable.findMany({
      where: { clientId, parentId: null, recurrenceId: { not: null }, budgetId: { not: null }, deletedAt: null },
      select: { id: true, budgetId: true },
    })
    for (const root of payableRoots) {
      await this.prisma.treasuryPayable.updateMany({
        where: { clientId, parentId: root.id, budgetId: null, deletedAt: null },
        data: { budgetId: root.budgetId },
      })
    }
    const receivableRoots = await this.prisma.treasuryReceivable.findMany({
      where: { clientId, parentId: null, recurrenceId: { not: null }, budgetId: { not: null }, deletedAt: null },
      select: { id: true, budgetId: true },
    })
    for (const root of receivableRoots) {
      await this.prisma.treasuryReceivable.updateMany({
        where: { clientId, parentId: root.id, budgetId: null, deletedAt: null },
        data: { budgetId: root.budgetId },
      })
    }

    const recurrences = await this.prisma.treasuryRecurrence.findMany({
      where: {
        clientId,
        isActive: true,
        nextRunAt: { lte: horizon },
      },
      include: {
        receivables: { where: { deletedAt: null, parentId: null }, take: 1 },
        payables:    { where: { deletedAt: null, parentId: null }, take: 1 },
      },
    })

    let created = 0

    for (const rec of recurrences) {
      const isReceivable = rec.receivables.length > 0
      const root = isReceivable ? rec.receivables[0] : rec.payables[0]
      if (!root) continue

      let nextDate = rec.nextRunAt ?? computeNextDate(root.dueDate, rec.frequency)

      while (nextDate <= horizon) {
        // Check end date
        if (rec.endDate && nextDate > rec.endDate) {
          await this.prisma.treasuryRecurrence.update({ where: { id: rec.id }, data: { isActive: false } })
          break
        }

        // Check occurrence limit
        if (rec.occurrences !== null) {
          const countR = await this.prisma.treasuryReceivable.count({ where: { recurrenceId: rec.id, deletedAt: null } })
          const countP = await this.prisma.treasuryPayable.count({ where: { recurrenceId: rec.id, deletedAt: null } })
          if (countR + countP >= rec.occurrences) {
            await this.prisma.treasuryRecurrence.update({ where: { id: rec.id }, data: { isActive: false } })
            break
          }
        }

        const dateKey = nextDate.toISOString().slice(0, 7).replace('-', '') // YYYYMM
        // Derive the child reference from the root: when the root has no reference we
        // store null on the child too (multiple null values are allowed by Postgres in
        // a UNIQUE index). Concatenating the string "null/YYYYMM" was the previous bug:
        // it created cross-recurrence collisions for every reference-less recurrence.
        const newRef = root.reference ? `${root.reference}/${dateKey}` : null

        // Deduplicate per (recurrenceId, dueDate, not deleted) — that's the natural
        // identity of a generated instance and avoids the reference-collision trap.
        // We also try/catch P2002 just in case two parallel processForClient calls
        // race past the existence check at the same time.
        if (isReceivable) {
          const exists = await this.prisma.treasuryReceivable.findFirst({
            where: { recurrenceId: rec.id, dueDate: nextDate, deletedAt: null, parentId: { not: null } },
            select: { id: true },
          })
          if (!exists) {
            try {
              await this.prisma.treasuryReceivable.create({
                data: {
                  clientId,
                  createdById: root.createdById,
                  origin: root.origin,
                  categoryId: root.categoryId,
                  entityName: root.entityName,
                  entityNif: root.entityNif,
                  reference: newRef,
                  description: root.description,
                  documentDate: nextDate,
                  dueDate: nextDate,
                  totalAmount: root.totalAmount,
                  pendingAmount: root.totalAmount,
                  currency: root.currency,
                  recurrenceId: rec.id,
                  parentId: root.id,
                  ...(root.budgetId ? { budgetId: root.budgetId } : {}),
                },
              })
              created++
            } catch (err) {
              if (!(err && typeof err === 'object' && 'code' in err && err.code === 'P2002')) throw err
            }
          }
        } else {
          const payRoot = rec.payables[0]
          const exists = await this.prisma.treasuryPayable.findFirst({
            where: { recurrenceId: rec.id, dueDate: nextDate, deletedAt: null, parentId: { not: null } },
            select: { id: true },
          })
          if (!exists) {
            try {
              await this.prisma.treasuryPayable.create({
                data: {
                  clientId,
                  createdById: payRoot.createdById,
                  origin: payRoot.origin,
                  categoryId: payRoot.categoryId,
                  entityName: payRoot.entityName,
                  entityNif: payRoot.entityNif,
                  reference: newRef,
                  description: payRoot.description,
                  documentDate: nextDate,
                  dueDate: nextDate,
                  totalAmount: payRoot.totalAmount,
                  pendingAmount: payRoot.totalAmount,
                  currency: payRoot.currency,
                  recurrenceId: rec.id,
                  parentId: payRoot.id,
                  ...(payRoot.budgetId ? { budgetId: payRoot.budgetId } : {}),
                },
              })
              created++
            } catch (err) {
              if (!(err && typeof err === 'object' && 'code' in err && err.code === 'P2002')) throw err
            }
          }
        }

        nextDate = computeNextDate(nextDate, rec.frequency)
      }

      await this.prisma.treasuryRecurrence.update({
        where: { id: rec.id },
        data: { nextRunAt: nextDate, lastRunAt: now },
      })
    }

    return { created }
  }
}
