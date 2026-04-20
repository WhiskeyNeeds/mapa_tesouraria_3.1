import { createHash } from 'crypto'
import type { PrismaClient, TreasuryMovementSource, TreasuryMovementStatus, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { TreasuryBankAccountsService } from '../bank-accounts/bank-accounts.service.js'

export interface CsvMovement {
  date: string
  amount: number
  description: string
  bookingDate?: string
  balanceAfter?: number
  counterpartName?: string
  counterpartIban?: string
  externalRef?: string
}

export class TreasuryBankMovementsService {
  private bankSvc: TreasuryBankAccountsService

  constructor(private prisma: PrismaClient) {
    this.bankSvc = new TreasuryBankAccountsService(prisma)
  }

  private buildDedupeHash(clientId: string, bankAccountId: string, date: string, amount: number, desc: string): string {
    return createHash('sha256').update(`${clientId}|${bankAccountId}|${date}|${amount}|${desc}`).digest('hex')
  }

  private normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  }

  async list(clientId: string, filters: {
    bankAccountId?: string
    status?: TreasuryMovementStatus
    dateFrom?: string
    dateTo?: string
    page?: number
    limit?: number
  }) {
    const { page = 1, limit = 50, bankAccountId, status, dateFrom, dateTo } = filters
    const where: Prisma.TreasuryBankMovementWhereInput = {
      clientId,
      deletedAt: null,
      ...(bankAccountId ? { bankAccountId } : {}),
      ...(status ? { status } : {}),
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        },
      } : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.treasuryBankMovement.count({ where }),
      this.prisma.treasuryBankMovement.findMany({
        where,
        include: { category: { select: { id: true, name: true, color: true, type: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return { total, page, limit, items }
  }

  async importMovements(clientId: string, bankAccountId: string, movements: CsvMovement[], source: TreasuryMovementSource, userId: string, importId?: string) {
    let imported = 0
    let duplicated = 0
    const failed: string[] = []

    // Apply classification rules
    const rules = await this.prisma.treasuryClassificationRule.findMany({
      where: { clientId, isActive: true },
      orderBy: { priority: 'asc' },
    })

    for (const mov of movements) {
      const dedupeHash = this.buildDedupeHash(clientId, bankAccountId, mov.date, mov.amount, mov.description)
      const normalizedDesc = this.normalize(mov.description)

      // Find matching rule
      let categoryId: string | undefined
      for (const rule of rules) {
        if (rule.direction && ((rule.direction === 'REVENUE') !== (mov.amount > 0))) continue
        if (rule.amountMin && Math.abs(mov.amount) < Number(rule.amountMin)) continue
        if (rule.amountMax && Math.abs(mov.amount) > Number(rule.amountMax)) continue

        const field = rule.matchField === 'description' ? normalizedDesc
          : rule.matchField === 'counterpart' ? (mov.counterpartName ?? '')
          : (mov.counterpartIban ?? '')

        let matches = false
        if (rule.matchOp === 'contains') matches = field.includes(this.normalize(rule.matchValue))
        else if (rule.matchOp === 'equals') matches = field === this.normalize(rule.matchValue)
        else if (rule.matchOp === 'startsWith') matches = field.startsWith(this.normalize(rule.matchValue))
        else if (rule.matchOp === 'regex') matches = new RegExp(rule.matchValue, 'i').test(field)

        if (matches) {
          categoryId = rule.categoryId
          await this.prisma.treasuryClassificationRule.update({
            where: { id: rule.id },
            data: { hits: { increment: 1 }, lastHitAt: new Date() },
          })
          break
        }
      }

      try {
        await this.prisma.treasuryBankMovement.create({
          data: {
            clientId,
            bankAccountId,
            date: new Date(mov.date),
            bookingDate: mov.bookingDate ? new Date(mov.bookingDate) : undefined,
            amount: mov.amount,
            balanceAfter: mov.balanceAfter,
            description: mov.description,
            normalizedDesc,
            counterpartName: mov.counterpartName,
            counterpartIban: mov.counterpartIban,
            externalRef: mov.externalRef,
            source,
            importId: importId ?? null,
            dedupeHash,
            status: categoryId ? 'CLASSIFIED' : 'UNCLASSIFIED',
            categoryId: categoryId ?? null,
          },
        })
        imported++
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('Unique constraint')) {
          duplicated++
        } else {
          failed.push(mov.description)
        }
      }
    }

    await this.bankSvc.recalcBalance(bankAccountId)
    return { imported, duplicated, failed: failed.length }
  }

  async classify(clientId: string, id: string, categoryId: string) {
    const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!mov) throw httpError(404, 'Movement not found')

    const newStatus = mov.status === 'UNCLASSIFIED' ? 'CLASSIFIED' : mov.status
    return this.prisma.treasuryBankMovement.update({ where: { id }, data: { categoryId, status: newStatus } })
  }

  async delete(clientId: string, id: string) {
    const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId } })
    if (!mov) throw httpError(404, 'Movement not found')
    if (mov.status === 'RECONCILED') throw httpError(409, 'Cannot delete a reconciled movement')
    await this.prisma.treasuryBankMovement.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async getSummary(clientId: string, bankAccountId?: string) {
    const where: Prisma.TreasuryBankMovementWhereInput = { clientId, deletedAt: null, ...(bankAccountId ? { bankAccountId } : {}) }
    const [incomeAgg, expenseAgg, byStatus] = await Promise.all([
      this.prisma.treasuryBankMovement.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
      this.prisma.treasuryBankMovement.aggregate({ where: { ...where, amount: { lt: 0 } }, _sum: { amount: true }, _count: true }),
      this.prisma.treasuryBankMovement.groupBy({ by: ['status'], where, _count: true }),
    ])

    return {
      totalIncome: Number(incomeAgg._sum.amount ?? 0),
      totalExpense: Number(expenseAgg._sum.amount ?? 0),
      countIncome: incomeAgg._count,
      countExpense: expenseAgg._count,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    }
  }
}
