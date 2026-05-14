import { createHash, randomUUID } from 'crypto'
import type { PrismaClient, TreasuryMovementSource, TreasuryMovementStatus, Prisma } from '@prisma/client'
import { Prisma as PrismaRuntime } from '@prisma/client'
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

  private findMatchingRule(
    rules: { id: string; direction: string | null; amountMin: unknown; amountMax: unknown; matchField: string; matchOp: string; matchValue: string; categoryId: string }[],
    amount: number,
    normalizedDesc: string,
    counterpartName?: string | null,
    counterpartIban?: string | null,
  ): { categoryId: string | undefined; ruleId: string | undefined } {
    for (const rule of rules) {
      if (rule.direction && ((rule.direction === 'REVENUE') !== (amount > 0))) continue
      if (rule.amountMin && Math.abs(amount) < Number(rule.amountMin)) continue
      if (rule.amountMax && Math.abs(amount) > Number(rule.amountMax)) continue

      const field = rule.matchField === 'description' ? normalizedDesc
        : rule.matchField === 'counterpart' ? this.normalize(counterpartName ?? '')
          : this.normalize(counterpartIban ?? '')

      const value = this.normalize(rule.matchValue)
      let matches = false
      if (rule.matchOp === 'contains') matches = field.includes(value)
      else if (rule.matchOp === 'equals') matches = field === value
      else if (rule.matchOp === 'startsWith') matches = field.startsWith(value)
      else if (rule.matchOp === 'regex') { try { matches = new RegExp(rule.matchValue, 'i').test(field) } catch { matches = false } }

      if (matches) return { categoryId: rule.categoryId, ruleId: rule.id }
    }
    return { categoryId: undefined, ruleId: undefined }
  }

  private buildDedupeHash(clientId: string, bankAccountId: string, date: string, amount: number, desc: string, balanceAfter?: number): string {
    const balance = balanceAfter != null ? String(balanceAfter) : ''
    return createHash('sha256').update(`${clientId}|${bankAccountId}|${date}|${amount}|${desc}|${balance}`).digest('hex')
  }

  private normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  }

  private toDateKey(date: string | Date): string {
    const d = date instanceof Date ? date : new Date(date)
    return d.toISOString().substring(0, 10)
  }

  private toAmountKey(amount: number): string {
    return Number(amount).toFixed(2)
  }

  private toBalanceKey(balanceAfter?: number | null): string {
    return balanceAfter == null ? '' : Number(balanceAfter).toFixed(2)
  }

  private buildLogicalKey(bankAccountId: string, date: string | Date, amount: number, normalizedDesc: string, balanceAfter?: number | null): string {
    return `${bankAccountId}|${this.toDateKey(date)}|${this.toAmountKey(amount)}|${normalizedDesc}|${this.toBalanceKey(balanceAfter)}`
  }

  async list(clientId: string, filters: {
    bankAccountId?: string
    status?: TreasuryMovementStatus | TreasuryMovementStatus[]
    categoryId?: string
    dateFrom?: string
    dateTo?: string
    search?: string
    direction?: 'income' | 'expense'
    sortBy?: 'date' | 'amount' | 'description' | 'balanceAfter'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    const { page = 1, limit = 50, bankAccountId, status, categoryId, dateFrom, dateTo, search, direction, sortBy = 'date', sortDir = 'desc' } = filters
    const statusFilter = Array.isArray(status)
      ? { status: { in: status } }
      : status ? { status } : {}
    const where: Prisma.TreasuryBankMovementWhereInput = {
      clientId,
      deletedAt: null,
      bankAccount: { deletedAt: null, isActive: true },
      ...(bankAccountId ? { bankAccountId } : {}),
      ...statusFilter,
      ...(categoryId ? { categoryId } : {}),
      ...(direction === 'income' ? { amount: { gt: 0 } } : direction === 'expense' ? { amount: { lt: 0 } } : {}),
      ...(search ? { normalizedDesc: { contains: this.normalize(search) } } : {}),
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
        },
      } : {}),
    }

    const dir = sortDir as 'asc' | 'desc'
    const orderBy = (
      sortBy === 'amount' ? [{ amount: dir }, { date: 'desc' as const }] :
        sortBy === 'description' ? [{ description: dir }, { date: 'desc' as const }] :
          sortBy === 'balanceAfter' ? [{ balanceAfter: dir }, { date: 'desc' as const }] :
            [{ date: dir }, { source: 'desc' as const }, { createdAt: 'asc' as const }]
    ) as Prisma.TreasuryBankMovementOrderByWithRelationInput[]

    const [total, items] = await Promise.all([
      this.prisma.treasuryBankMovement.count({ where }),
      this.prisma.treasuryBankMovement.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, color: true, type: true } },
          bankAccount: { select: { id: true, name: true, bankName: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    // Guarantee MANUAL movements appear last within each calendar day
    if (sortBy === 'date' || !sortBy) {
      items.sort((a, b) => {
        const dayA = a.date.toISOString().slice(0, 10)
        const dayB = b.date.toISOString().slice(0, 10)
        if (dayA !== dayB) return dir === 'desc' ? dayB.localeCompare(dayA) : dayA.localeCompare(dayB)
        const aM = a.source === 'MANUAL' ? 1 : 0
        const bM = b.source === 'MANUAL' ? 1 : 0
        return bM - aM
      })
    }

    return { total, page, limit, items }
  }

  async importMovements(clientId: string, bankAccountId: string, movements: CsvMovement[], source: TreasuryMovementSource, userId: string, importId?: string) {
    let imported = 0
    let duplicated = 0
    const failed: string[] = []

    // Pre-compute hashes for all incoming movements
    const incomingWithHash = movements.map((mov) => ({
      mov,
      dedupeHash: this.buildDedupeHash(clientId, bankAccountId, mov.date, mov.amount, mov.description, mov.balanceAfter),
      normalizedDesc: this.normalize(mov.description),
    }))

    // Bulk pre-check: fetch all existing hashes in one query
    const allHashes = incomingWithHash.map((m) => m.dedupeHash)
    const existing = await this.prisma.treasuryBankMovement.findMany({
      where: { clientId, bankAccountId, dedupeHash: { in: allHashes } },
      select: { dedupeHash: true },
    })
    const existingHashes = new Set(existing.map((e) => e.dedupeHash))

    // Separate new from duplicate movements upfront
    const hashFiltered = incomingWithHash.filter(({ dedupeHash }) => !existingHashes.has(dedupeHash))
    duplicated = incomingWithHash.length - hashFiltered.length

    // Second layer: logical duplicate detection (same day/value/normalized description/balance)
    const candidateDates = [...new Set(hashFiltered.map(({ mov }) => this.toDateKey(mov.date)))]
    const candidateAmounts = [...new Set(hashFiltered.map(({ mov }) => Number(mov.amount)))]
    const existingLogicalCandidates = (candidateDates.length && candidateAmounts.length)
      ? await this.prisma.treasuryBankMovement.findMany({
        where: {
          clientId,
          bankAccountId,
          deletedAt: null,
          date: { in: candidateDates.map((d) => new Date(d)) },
          amount: { in: candidateAmounts },
        },
        select: { id: true, date: true, amount: true, normalizedDesc: true, balanceAfter: true },
      })
      : []

    const existingLogicalKeys = new Set(
      existingLogicalCandidates.map((m) =>
        this.buildLogicalKey(
          bankAccountId,
          m.date,
          Number(m.amount),
          m.normalizedDesc ?? '',
          m.balanceAfter == null ? null : Number(m.balanceAfter)
        )
      )
    )

    // Map from keyNoBalance → id for existing movements with null balanceAfter
    // Used to patch balanceAfter on re-import instead of inserting a duplicate
    const nullBalanceMap = new Map<string, string>()
    for (const m of existingLogicalCandidates) {
      if (m.balanceAfter == null) {
        const k = `${bankAccountId}|${this.toDateKey(m.date)}|${this.toAmountKey(Number(m.amount))}|${m.normalizedDesc ?? ''}`
        nullBalanceMap.set(k, m.id)
      }
    }

    const toUpdateBalance: Array<{ id: string; balanceAfter: number }> = []
    const seenIncomingLogical = new Set<string>()
    const toInsert = hashFiltered.filter(({ mov, normalizedDesc }) => {
      const logicalKey = this.buildLogicalKey(bankAccountId, mov.date, mov.amount, normalizedDesc, mov.balanceAfter)
      if (existingLogicalKeys.has(logicalKey) || seenIncomingLogical.has(logicalKey)) {
        duplicated++
        return false
      }
      // Incoming movement carries a balance but the existing record has null — update, don't duplicate
      if (mov.balanceAfter != null) {
        const k = `${bankAccountId}|${this.toDateKey(mov.date)}|${this.toAmountKey(mov.amount)}|${normalizedDesc}`
        const existingId = nullBalanceMap.get(k)
        if (existingId) {
          toUpdateBalance.push({ id: existingId, balanceAfter: mov.balanceAfter })
          duplicated++
          return false
        }
      }
      seenIncomingLogical.add(logicalKey)
      return true
    })

    // Patch balanceAfter on existing movements that previously had null
    for (const { id, balanceAfter } of toUpdateBalance) {
      await this.prisma.treasuryBankMovement.update({ where: { id }, data: { balanceAfter } })
    }

    // Load classification rules once
    const rules = await this.prisma.treasuryClassificationRule.findMany({
      where: { clientId, isActive: true },
      orderBy: { priority: 'asc' },
    })

    for (const { mov, dedupeHash, normalizedDesc } of toInsert) {
      const { categoryId, ruleId } = this.findMatchingRule(rules, mov.amount, normalizedDesc, mov.counterpartName, mov.counterpartIban)
      if (ruleId) {
        await this.prisma.treasuryClassificationRule.update({
          where: { id: ruleId },
          data: { hits: { increment: 1 }, lastHitAt: new Date() },
        })
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
        // Safety net for race conditions: another import inserted same hash concurrently
        if (err instanceof PrismaRuntime.PrismaClientKnownRequestError && err.code === 'P2002') {
          duplicated++
        } else {
          failed.push(mov.description)
        }
      }
    }

    await this.bankSvc.recalcBalance(bankAccountId)
    return { imported, duplicated, failed: failed.length }
  }

  async createManual(clientId: string, data: {
    bankAccountId: string
    date: string
    amount: number
    description: string
  }, userId?: string) {
    const account = await this.prisma.treasuryBankAccount.findFirst({
      where: { id: data.bankAccountId, clientId, deletedAt: null, isActive: true },
    })
    if (!account) throw httpError(404, 'Bank account not found')

    const normalizedDesc = this.normalize(data.description)
    const rules = await this.prisma.treasuryClassificationRule.findMany({
      where: { clientId, isActive: true },
      orderBy: { priority: 'asc' },
    })
    const { categoryId, ruleId } = this.findMatchingRule(rules, data.amount, normalizedDesc)
    if (ruleId) {
      await this.prisma.treasuryClassificationRule.update({
        where: { id: ruleId },
        data: { hits: { increment: 1 }, lastHitAt: new Date() },
      })
    }

    const movement = await this.prisma.treasuryBankMovement.create({
      data: {
        clientId,
        bankAccountId: data.bankAccountId,
        date: new Date(data.date),
        amount: data.amount,
        description: data.description.trim(),
        normalizedDesc,
        source: 'MANUAL',
        dedupeHash: randomUUID(),
        status: categoryId ? 'CLASSIFIED' : 'UNCLASSIFIED',
        categoryId: categoryId ?? null,
      },
    })

    if (userId) {
      await this.prisma.treasuryAuditLog.create({
        data: {
          clientId, userId, action: 'movement.create', entityType: 'BankMovement', entityId: movement.id,
          payload: { bankAccountId: data.bankAccountId, date: data.date, amount: data.amount }
        },
      })
    }

    await this.bankSvc.recalcBalance(data.bankAccountId)
    return movement
  }

  async deduplicateMovements(clientId: string, bankAccountId?: string): Promise<{ removed: number }> {
    const where = { clientId, deletedAt: null, bankAccount: { deletedAt: null, isActive: true }, ...(bankAccountId ? { bankAccountId } : {}) }
    const all = await this.prisma.treasuryBankMovement.findMany({
      where,
      select: { id: true, bankAccountId: true, date: true, amount: true, normalizedDesc: true, balanceAfter: true, createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by (bankAccountId, date, amount, normalizedDesc, balanceAfter) — keep oldest, soft-delete newer duplicates
    const seen = new Map<string, boolean>()
    const toRemove: string[] = []

    for (const mov of all) {
      const balance = mov.balanceAfter != null ? String(mov.balanceAfter) : ''
      const key = `${mov.bankAccountId}|${mov.date.toISOString()}|${mov.amount}|${mov.normalizedDesc ?? ''}|${balance}`
      if (seen.has(key)) {
        if (mov.status !== 'RECONCILED') toRemove.push(mov.id)
      } else {
        seen.set(key, true)
      }
    }

    if (toRemove.length > 0) {
      await this.prisma.treasuryBankMovement.updateMany({
        where: { id: { in: toRemove } },
        data: { deletedAt: new Date() },
      })
      // Recalc balance for affected accounts
      const affectedAccounts = [...new Set(
        all.filter((m) => toRemove.includes(m.id)).map((m) => m.bankAccountId)
      )]
      for (const accId of affectedAccounts) {
        await this.bankSvc.recalcBalance(accId)
      }
    }

    return { removed: toRemove.length }
  }

  async updateDescription(clientId: string, id: string, description: string) {
    const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!mov) throw httpError(404, 'Movement not found')
    if (!description.trim()) throw httpError(400, 'Description cannot be empty')
    return this.prisma.treasuryBankMovement.update({ where: { id }, data: { description: description.trim() } })
  }

  async classify(clientId: string, id: string, categoryId: string | null) {
    const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!mov) throw httpError(404, 'Movement not found')

    const newStatus = categoryId === null ? 'UNCLASSIFIED' : mov.status === 'UNCLASSIFIED' ? 'CLASSIFIED' : mov.status
    return this.prisma.treasuryBankMovement.update({ where: { id }, data: { categoryId, status: newStatus } })
  }

  async delete(clientId: string, id: string, userId?: string) {
    const mov = await this.prisma.treasuryBankMovement.findFirst({ where: { id, clientId } })
    if (!mov) throw httpError(404, 'Movement not found')
    if (mov.status === 'RECONCILED') throw httpError(409, 'Cannot delete a reconciled movement')
    await this.prisma.treasuryBankMovement.update({ where: { id }, data: { deletedAt: new Date() } })
    if (userId) {
      await this.prisma.treasuryAuditLog.create({
        data: {
          clientId, userId, action: 'movement.delete', entityType: 'BankMovement', entityId: id,
          payload: { bankAccountId: mov.bankAccountId, amount: Number(mov.amount), source: mov.source }
        },
      })
    }
    await this.bankSvc.recalcBalance(mov.bankAccountId)
  }

  async applyRulesToExisting(clientId: string): Promise<{ classified: number; skipped: number }> {
    const [rules, unclassified] = await Promise.all([
      this.prisma.treasuryClassificationRule.findMany({
        where: { clientId, isActive: true },
        orderBy: { priority: 'asc' },
      }),
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, status: 'UNCLASSIFIED' },
        select: { id: true, amount: true, normalizedDesc: true, counterpartName: true, counterpartIban: true },
      }),
    ])

    if (rules.length === 0 || unclassified.length === 0) return { classified: 0, skipped: unclassified.length }

    let classified = 0
    const ruleHits = new Map<string, number>()

    for (const mov of unclassified) {
      const { categoryId, ruleId } = this.findMatchingRule(
        rules, Number(mov.amount), mov.normalizedDesc ?? '', mov.counterpartName, mov.counterpartIban
      )
      if (categoryId && ruleId) {
        await this.prisma.treasuryBankMovement.update({
          where: { id: mov.id },
          data: { categoryId, status: 'CLASSIFIED' },
        })
        ruleHits.set(ruleId, (ruleHits.get(ruleId) ?? 0) + 1)
        classified++
      }
    }

    // Batch update rule hit counts
    await Promise.all(
      Array.from(ruleHits.entries()).map(([id, count]) =>
        this.prisma.treasuryClassificationRule.update({
          where: { id },
          data: { hits: { increment: count }, lastHitAt: new Date() },
        })
      )
    )

    return { classified, skipped: unclassified.length - classified }
  }

  async checkBalanceConsistency(clientId: string, bankAccountId?: string): Promise<{
    accountId: string
    accountName: string
    gaps: {
      afterMovementId: string
      afterDate: string
      afterDescription: string
      afterBalance: number
      beforeMovementId: string
      beforeDate: string
      beforeDescription: string
      expectedBalance: number
      actualBalance: number
      gap: number
    }[]
  }[]> {
    const accounts = bankAccountId
      ? await this.prisma.treasuryBankAccount.findMany({ where: { id: bankAccountId, clientId, deletedAt: null }, select: { id: true, name: true } })
      : await this.prisma.treasuryBankAccount.findMany({ where: { clientId, deletedAt: null, isActive: true }, select: { id: true, name: true } })

    const results: Awaited<ReturnType<typeof this.checkBalanceConsistency>> = []

    for (const account of accounts) {
      const movements = await this.prisma.treasuryBankMovement.findMany({
        where: { bankAccountId: account.id, deletedAt: null, balanceAfter: { not: null } },
        select: { id: true, date: true, amount: true, balanceAfter: true, description: true, source: true, createdAt: true },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })

      // Build consistency chain in business order:
      // imported movements first (oldest -> newest), then MANUAL movements at end of day.
      movements.sort((a, b) => {
        const dayA = a.date.toISOString().slice(0, 10)
        const dayB = b.date.toISOString().slice(0, 10)
        if (dayA !== dayB) return dayA.localeCompare(dayB)

        const aManual = a.source === 'MANUAL'
        const bManual = b.source === 'MANUAL'
        if (aManual !== bManual) return aManual ? 1 : -1

        if (!aManual && !bManual) {
          return b.createdAt.getTime() - a.createdAt.getTime()
        }

        return a.createdAt.getTime() - b.createdAt.getTime()
      })

      const gaps: (typeof results)[0]['gaps'] = []
      for (let i = 1; i < movements.length; i++) {
        const prev = movements[i - 1]
        const curr = movements[i]
        const calculated = Math.round((Number(prev.balanceAfter) + Number(curr.amount)) * 100) / 100
        const actual = Math.round(Number(curr.balanceAfter) * 100) / 100
        const gap = Math.round((calculated - actual) * 100) / 100
        if (Math.abs(gap) > 0.01) {
          gaps.push({
            afterMovementId: prev.id,
            afterDate: prev.date.toISOString().slice(0, 10),
            afterDescription: prev.description ?? '',
            afterBalance: Number(prev.balanceAfter),
            beforeMovementId: curr.id,
            beforeDate: curr.date.toISOString().slice(0, 10),
            beforeDescription: curr.description ?? '',
            expectedBalance: calculated,
            actualBalance: actual,
            gap,
          })
        }
      }

      results.push({ accountId: account.id, accountName: account.name, gaps })
    }

    return results
  }

  async getSummary(clientId: string, filters: {
    bankAccountId?: string
    dateFrom?: string
    dateTo?: string
    search?: string
    direction?: 'income' | 'expense'
    status?: TreasuryMovementStatus
    categoryId?: string
  } = {}) {
    const { bankAccountId, dateFrom, dateTo, search, direction, status, categoryId } = filters
    const where: Prisma.TreasuryBankMovementWhereInput = {
      clientId,
      deletedAt: null,
      bankAccount: { deletedAt: null, isActive: true },
      ...(bankAccountId ? { bankAccountId } : {}),
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(direction === 'income' ? { amount: { gt: 0 } } : direction === 'expense' ? { amount: { lt: 0 } } : {}),
      ...(search ? { normalizedDesc: { contains: this.normalize(search) } } : {}),
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
        },
      } : {}),
    }
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
